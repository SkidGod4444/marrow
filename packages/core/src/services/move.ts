import { and, desc, eq, notInArray } from "drizzle-orm";
import { type Db, type Item, type Job, type Namespace, entities, items, jobs, mentions, segments, usageLog } from "../db/index.ts";
import type { StageName } from "../document.ts";
import { newId } from "../ids.ts";
import type { Enrichment } from "../pipeline/prompts.ts";
import { loadDocument, saveDocument } from "../pipeline/runner.ts";
import type { Storage } from "../storage/index.ts";
import { invalidateDocument } from "./documents.ts";
import { upsertEntityIndex } from "./entities.ts";
import { getNamespace } from "./namespaces.ts";

// Moving an item between namespaces (same workspace). Everything namespace-scoped follows it: the search index
// (segments), the spend ledger rows, and the entity index — the item leaves the old namespace's entities (orphans are
// pruned) and joins the new one's, rebuilt from the document without another LLM call. What a namespace *changes* is
// re-run through a small job at the same document version: the novelty verdict (relative to the new corpus) and, in
// a language-mode namespace, the expression pass — so the Language tab appears on arrival.

export type MoveInput = { itemId: string; namespace: string; organizationId?: string };
export type MoveResult = { item: Item; from: Namespace; to: Namespace; job: Job | null; replaced: string | null; reindexed: { entities: number; mentions: number } | null };
type MoveDeps = { db: Db; storage: Storage; queue?: { enqueue(jobId: string): Promise<void> } };

const STORAGE_PREFIXES = (id: string) => [`frames/${id}/`, `clips/${id}/`, `raw/${id}/`];

export async function moveItem(deps: MoveDeps, input: MoveInput): Promise<MoveResult> {
  const { db, storage } = deps;
  const [item] = await db.select().from(items).where(eq(items.id, input.itemId));
  if (!item) throw new Error("item not found");
  const from = await getNamespace(db, item.namespaceId, input.organizationId);
  if (!from) throw new Error("item not found");
  const to = await getNamespace(db, input.namespace, input.organizationId);
  if (!to) throw new Error(`namespace "${input.namespace}" not found`);
  if (to.id === from.id) return { item, from, to, job: null, replaced: null, reindexed: null };
  if ((to.organizationId ?? null) !== (from.organizationId ?? null)) throw new Error("items can only move within their workspace");

  // The same link already in the target: a finished copy wins; a stalled one (queued / failed) gives way.
  const [dup] = await db.select().from(items).where(and(eq(items.namespaceId, to.id), eq(items.sourceUrl, item.sourceUrl)));
  let replaced: string | null = null;
  if (dup) {
    if (dup.status === "ready") throw new Error(`"${to.name}" already has this one — open it there instead`);
    await db.delete(items).where(eq(items.id, dup.id)); // jobs, segments, mentions, ledger rows cascade
    await Promise.all([storage.delete(`documents/${dup.id}.json`), storage.delete(`audio/${dup.id}.ogg`), ...STORAGE_PREFIXES(dup.id).map((p) => storage.deletePrefix(p))]).catch(() => undefined);
    replaced = dup.id;
  }

  await db.update(items).set({ namespaceId: to.id, novelty: null, updatedAt: new Date() }).where(eq(items.id, item.id));
  await db.update(segments).set({ namespaceId: to.id }).where(eq(segments.itemId, item.id));
  await db.update(usageLog).set({ namespaceId: to.id }).where(eq(usageLog.itemId, item.id));

  // Entity index: leave, prune what nobody mentions any more, join from the document.
  await db.delete(mentions).where(eq(mentions.itemId, item.id));
  await db.delete(entities).where(and(eq(entities.namespaceId, from.id), notInArray(entities.id, db.select({ id: mentions.entityId }).from(mentions))));
  let reindexed: MoveResult["reindexed"] = null;
  const doc = await loadDocument(storage, item.id);
  if (doc) {
    if (doc.references.length || doc.claims.length) {
      const enrichment: Enrichment = {
        references: doc.references.map((r) => ({ kind: r.kind, name: r.name, raw_mention: r.raw_mention, t: r.t ?? null, search_query: "" })),
        claims: doc.claims.map((c) => ({ entity: c.entity, claim_text: c.claim_text, stance: c.stance, t: c.t ?? null, quote: c.quote })),
        entities: [],
      };
      const urls = new Map(doc.references.map((r) => [r.name.toLowerCase(), r.resolved_url ?? null]));
      reindexed = await upsertEntityIndex(db, { namespaceId: to.id, itemId: item.id, enrichment, urls });
    }
    doc.namespace_id = to.id;
    doc.novelty = null;
    await saveDocument(storage, doc);
    invalidateDocument(item.id);
  }

  // What the namespace decides gets recomputed: novelty against the new corpus, expressions in a language namespace.
  let job: Job | null = null;
  if (item.status === "ready") {
    job = await requeueStages(db, item.id, ["language", "novelty"]);
    if (job && deps.queue) await deps.queue.enqueue(job.id);
  }
  const [moved] = await db.select().from(items).where(eq(items.id, item.id));
  return { item: moved!, from, to, job, replaced, reindexed };
}

/**
 * A new job at the *same* document version whose stage map forgets `redo`: the runner keeps the document, skips every
 * stage still marked done or skipped, and re-runs only those. Null when the item has no finished job to build on.
 */
export async function requeueStages(db: Db, itemId: string, redo: StageName[]): Promise<Job | null> {
  const [latest] = await db.select().from(jobs).where(eq(jobs.itemId, itemId)).orderBy(desc(jobs.version), desc(jobs.createdAt)).limit(1);
  if (!latest || latest.state !== "done") return null;
  const stages = { ...latest.stages };
  for (const s of redo) delete stages[s];
  const [job] = await db.insert(jobs).values({ id: newId("job"), itemId, version: latest.version, state: "queued", stages }).returning();
  return job!;
}
