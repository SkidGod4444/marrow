import { sql } from "drizzle-orm";
import {
  boolean, customType, doublePrecision, index, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex, vector,
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

// ---- Accounts (Better Auth, default model shape; snake_case columns) ----
export const authUsers = pgTable("auth_user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const authSessions = pgTable(
  "auth_session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (t) => [index("auth_session_user_idx").on(t.userId)],
);
export const authAccounts = pgTable(
  "auth_account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer"), // Better Auth ≥ 1.7: OIDC issuer for social providers; null for email + password
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_account_user_idx").on(t.userId)],
);
export const authVerifications = pgTable(
  "auth_verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_verification_identifier_idx").on(t.identifier)],
);

// ---- Workspaces (Better Auth organization plugin, default model shape; owner decision 2026-08-28: multi-tenant SaaS) ----
export const authOrganizations = pgTable("auth_organization", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  metadata: text("metadata"),
});
export const authMembers = pgTable(
  "auth_member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => authOrganizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("member"), // owner | admin | member | viewer
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auth_member_org_idx").on(t.organizationId), index("auth_member_user_idx").on(t.userId), uniqueIndex("auth_member_org_user_uq").on(t.organizationId, t.userId)],
);
export const authInvitations = pgTable(
  "auth_invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => authOrganizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    inviterId: text("inviter_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  },
  (t) => [index("auth_invitation_org_idx").on(t.organizationId), index("auth_invitation_email_idx").on(t.email)],
);
/** Per-user API keys for MCP/CLI (Better Auth api-key plugin, default model shape). `metadata` carries the workspace. */
export const authApiKeys = pgTable(
  "auth_apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(), // user id
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at", { withTimezone: true }),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (t) => [index("auth_apikey_reference_idx").on(t.referenceId), index("auth_apikey_key_idx").on(t.key)],
);

export const namespaces = pgTable(
  "namespaces",
  {
    id: text("id").primaryKey(),
    /** The workspace that owns it. Nullable only for rows created before multi-tenancy; adopted on the first workspace's creation. */
    organizationId: text("organization_id").references(() => authOrganizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    summary: text("summary"),
    flags: jsonb("flags").$type<NamespaceFlags>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("namespaces_org_name_uq").on(t.organizationId, t.name), index("namespaces_org_idx").on(t.organizationId)],
);

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

/** PRD §6.3 review queue: an expression the owner marked "learn", with its spaced-repetition schedule. */
export const expressionReviews = pgTable(
  "expression_reviews",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    userId: text("user_id"), // the learner (Practice is personal); null only for rows from before multi-tenancy
    n: integer("n").notNull(), // index into the item's language_pack.expressions
    text: text("text").notNull(),
    kind: text("kind").notNull(),
    explanation: text("explanation").notNull(),
    context: text("context"),
    tStart: real("t_start").notNull(),
    tEnd: real("t_end").notNull(),
    clipKey: text("clip_key"),
    stage: integer("stage").notNull().default(0), // 0 → due in 2d, 1 → 7d, 2+ → 30d
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    reviews: integer("reviews").notNull().default(0),
    lastResult: text("last_result"), // got_it | again
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("expression_reviews_user_item_n_uq").on(t.userId, t.itemId, t.n), index("expression_reviews_due_idx").on(t.dueAt), index("expression_reviews_user_idx").on(t.userId)],
);
export type ExpressionReview = typeof expressionReviews.$inferSelect;

export const events = pgTable("events", {
  id: text("id").primaryKey(),
  itemId: text("item_id").notNull().references(() => items.id, { onDelete: "cascade" }),
  userId: text("user_id"), // who did it (null for the pipeline's own `ingested`)
  kind: text("kind").notNull(), // ingested | read | chatted | skipped | expression_saved
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The spend ledger (PRD §5 "every stage logs its API spend", extended to everything): one row per model per unit of
 * work — a pipeline stage of a job, a namespace-summary refresh, a chat turn — so an item's total is a sum, not a guess.
 */
export const usageLog = pgTable(
  "usage_log",
  {
    id: text("id").primaryKey(),
    itemId: text("item_id").references(() => items.id, { onDelete: "cascade" }), // null for namespace-level work
    namespaceId: text("namespace_id").references(() => namespaces.id, { onDelete: "cascade" }),
    userId: text("user_id"), // who chatted; null for the pipeline
    jobId: text("job_id"), // pipeline rows: the job (unique with stage + model, so a retried stage replaces its row)
    source: text("source").notNull(), // pipeline | summary | chat | namespace_chat
    stage: text("stage"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    audioSeconds: doublePrecision("audio_seconds").notNull().default(0),
    requests: integer("requests").notNull().default(0),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usage_log_item_idx").on(t.itemId), index("usage_log_ns_idx").on(t.namespaceId), uniqueIndex("usage_log_job_stage_model_uq").on(t.jobId, t.stage, t.model)],
);
export type UsageRow = typeof usageLog.$inferSelect;

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
export type Organization = typeof authOrganizations.$inferSelect;
export type Member = typeof authMembers.$inferSelect;
export type Item = typeof items.$inferSelect;
export type Segment = typeof segments.$inferSelect;
export type FrameRow = typeof frames.$inferSelect;
export type Entity = typeof entities.$inferSelect;
export type Mention = typeof mentions.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Note = typeof notes.$inferSelect;
