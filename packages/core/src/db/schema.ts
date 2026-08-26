import { sql } from "drizzle-orm";
import {
  customType, doublePrecision, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, vector,
} from "drizzle-orm/pg-core";
import type { Novelty, StageName } from "../document.ts";

// PRD §12 minimum tables. Enums are plain text columns validated in code.

export type NamespaceFlags = {
  language_learning?: boolean;
  /** Force (true) or suppress (false) speaker diarization for every item; unset = heuristics. */
  diarize?: boolean;
  auto_ingest_links?: boolean;
  ingest_papers?: boolean;
};

export type StageRecord = {
  state: "queued" | "running" | "done" | "skipped" | "failed";
  started_at?: string;
  finished_at?: string;
  error?: string;
  skipped_reason?: string;
  usage?: Record<string, number>;
  cost_usd?: number;
};

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const namespaces = pgTable("namespaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  summary: text("summary"),
  flags: jsonb("flags").$type<NamespaceFlags>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sources = pgTable("sources", {
  id: text("id").primaryKey(),
  namespaceId: text("namespace_id").notNull().references(() => namespaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // playlist | channel | rss | email
  url: text("url").notNull(),
  title: text("title"),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("sources_ns_url_uq").on(t.namespaceId, t.url)]);
export type Source = typeof sources.$inferSelect;

export const items = pgTable(
  "items",
  {
    id: text("id").primaryKey(),
    namespaceId: text("namespace_id").notNull().references(() => namespaces.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull().default(""),
    channel: text("channel").notNull().default(""),
    status: text("status").notNull().default("queued"), // queued | running | failed | ready
    documentKey: text("document_key"),
    novelty: jsonb("novelty").$type<Novelty>(),
    summary: text("summary"), // article summary, denormalised for the inbox
    archivedAt: timestamp("archived_at", { withTimezone: true }), // inbox "Skip" (PRD §6.4)
    durationS: real("duration_s"),
    language: text("language"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("items_ns_url_uq").on(t.namespaceId, t.sourceUrl), index("items_ns_status_idx").on(t.namespaceId, t.status)],
);

export const segments = pgTable(
  "segments",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    namespaceId: text("namespace_id").notNull().references(() => namespaces.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    position: integer("position").notNull().default(0),
    tStart: real("t_start"),
    tEnd: real("t_end"),
    text: text("text").notNull(),
    frameIds: jsonb("frame_ids").$type<string[]>().notNull().default([]),
    embedding: vector("embedding", { dimensions: 1536 }),
    tsv: tsvector("tsv").generatedAlwaysAs(sql`to_tsvector('english', "text")`),
  },
  (t) => [
    index("segments_item_idx").on(t.itemId),
    index("segments_ns_idx").on(t.namespaceId),
    index("segments_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("segments_tsv_idx").using("gin", t.tsv),
  ],
);

/** Keyframes, mirrored from the document so `get_frame` and search-result captions don't need the JSON. */
export const frames = pgTable(
  "frames",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    t: real("t").notNull(),
    s3Key: text("s3_key").notNull(),
    caption: text("caption"),
    ocrText: text("ocr_text"),
    sceneScore: real("scene_score"),
  },
  (t) => [index("frames_item_t_idx").on(t.itemId, t.t)],
);

export const entities = pgTable(
  "entities",
  {
    id: text("id").primaryKey(),
    namespaceId: text("namespace_id").notNull().references(() => namespaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(), // lowercased, for dedupe
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    url: text("url"),
    kind: text("kind").notNull(), // paper | tool | repo | person | technique | dataset | other
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entities_ns_name_uq").on(t.namespaceId, t.nameKey)],
);

export const mentions = pgTable(
  "mentions",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    t: real("t"),
    quote: text("quote"),
    claimText: text("claim_text"),
    stance: text("stance"), // supports | opposes | neutral
  },
  (t) => [index("mentions_entity_idx").on(t.entityId), index("mentions_item_idx").on(t.itemId)],
);

export const notes = pgTable("notes", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  t: real("t"),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // ingested | read | chatted | skipped | expression_saved
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    stage: text("stage").$type<StageName | null>(),
    state: text("state").notNull().default("queued"), // queued | running | failed | done
    error: text("error"),
    stages: jsonb("stages").$type<Partial<Record<StageName, StageRecord>>>().notNull().default({}),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_item_idx").on(t.itemId)],
);

export type Namespace = typeof namespaces.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Segment = typeof segments.$inferSelect;
export type FrameRow = typeof frames.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type Mention = typeof mentions.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Note = typeof notes.$inferSelect;
