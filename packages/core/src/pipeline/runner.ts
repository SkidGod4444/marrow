import { rm } from "node:fs/promises";
import { addTotals, describeUsage, jobTotals, recordPipelineUsage, splitTrackerUsage, zeroTotals } from "../services/usage.ts";
import { costUsd } from "../openai/client.ts";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { Config } from "../config.ts";
import { type Db, type Job, type StageRecord, events, items, jobs, namespaces } from "../db/index.ts";
import { STAGE_NAMES, type StageName, type VideoDocument, VideoDocumentSchema, documentKey, newDocument, rawPrefix } from "../document.ts";
import { isTextSource, newId } from "../ids.ts";
import { UsageTracker } from "../openai/client.ts";
import type { Storage } from "../storage/index.ts";
import { invalidateDocument } from "../services/documents.ts";
import { maybeRefreshNamespaceSummary } from "../services/summary.ts";
import { nowIso } from "../util.ts";
import { STAGES } from "./stages/index.ts";
import type { Providers, StageContext } from "./types.ts";

export type PipelineDeps = {
  db: Db;
  storage: Storage;
  config: Config;
  providers: Providers;
  log?: (msg: string) => void;
};

export async function loadDocument(storage: Storage, itemId: string): Promise<VideoDocument | null> {
  const key = documentKey(itemId);
  if (!(await storage.exists(key))) return null;
  const raw = new TextDecoder().decode(await storage.get(key));
  return VideoDocumentSchema.parse(JSON.parse(raw));
}

export async function saveDocument(storage: Storage, doc: VideoDocument): Promise<void> {
  await storage.put(documentKey(doc.id), JSON.stringify(doc, null, 2), "application/json");
  invalidateDocument(doc.id);
}

/**
 * Runs one pipeline job (PRD §5): stages in order, each checkpointed in `jobs.stages` so a failed run resumes at the
 * failed stage; the document is persisted after every stage. `opts.stages` forces specific stages to re-run.
 */
/** Per-stage totals for the log line (the tracker is flat "<model>.<metric>"). */
function trackerTotals(flat: Record<string, number>) {
  let t = zeroTotals();
  for (const [model, u] of Object.entries(splitTrackerUsage(flat))) t = addTotals(t, { input_tokens: u.input_tokens, cached_input_tokens: u.cached_input_tokens, output_tokens: u.output_tokens, audio_seconds: u.audio_seconds, requests: u.requests, cost_usd: costUsd(model, u) });
  return t;
}

export async function runJob(deps: PipelineDeps, jobId: string, opts: { stages?: StageName[] } = {}): Promise<Job> {
  const { db, storage, config, providers } = deps;
  const log = (msg: string) => deps.log?.(msg);

  const [job0] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job0) throw new Error(`job ${jobId} not found`);
  const [item] = await db.select().from(items).where(eq(items.id, job0.itemId));
  if (!item) throw new Error(`item ${job0.itemId} not found`);
  const [namespace] = await db.select().from(namespaces).where(eq(namespaces.id, item.namespaceId));
  if (!namespace) throw new Error(`namespace ${item.namespaceId} not found`);

  const job: Job = { ...job0, stages: { ...job0.stages } };
  const forced = new Set(opts.stages ?? []);
  for (const s of forced) delete job.stages[s];
  if (job.state === "done" && forced.size === 0) return job;

  const existing = await loadDocument(storage, item.id);
  const doc =
    existing && existing.pipeline.version === job.version
      ? existing
      : newDocument({ id: item.id, namespace_id: namespace.id, source_type: item.sourceType as VideoDocument["source_type"], source_url: item.sourceUrl, version: job.version });
  if (doc !== existing && existing && isTextSource(item.sourceType)) {
    // Captured text has no upstream to re-fetch from (pasted posts, emails): carry it into the new version.
    Object.assign(doc, { title: existing.title, author: existing.author, channel: existing.channel, description: existing.description, published_at: existing.published_at, body_md: existing.body_md, linked_videos: existing.linked_videos, has_video: false });
  }
  const workDir = join(config.WORK_DIR, item.id);

  const saveJob = async () => {
    job.updatedAt = new Date();
    await db
      .update(jobs)
      .set({ stage: job.stage, state: job.state, error: job.error, stages: job.stages, costUsd: job.costUsd, updatedAt: job.updatedAt })
      .where(eq(jobs.id, job.id));
  };

  job.state = "running";
  job.error = null;
  await saveJob();
  await db.update(items).set({ status: "running", documentKey: documentKey(item.id), updatedAt: new Date() }).where(eq(items.id, item.id));

  for (const stage of STAGE_NAMES) {
    const prev = job.stages[stage];
    if (prev && (prev.state === "done" || prev.state === "skipped")) {
      log(`[${stage}] already ${prev.state} — skipping`);
      continue;
    }
    const usage = new UsageTracker();
    const rec: StageRecord = { state: "running", started_at: nowIso() };
    job.stages[stage] = rec;
    job.stage = stage;
    await saveJob();
    log(`[${stage}] start`);

    const ctx: StageContext = { db, storage, config, providers, item, namespace, job, doc, workDir, usage, log: (m) => log(`[${stage}] ${m}`) };
    try {
      const outcome = await STAGES[stage](ctx);
      rec.finished_at = nowIso();
      rec.usage = usage.usage;
      rec.cost_usd = usage.cost;
      if (outcome && "skipped" in outcome) {
        rec.state = "skipped";
        rec.skipped_reason = outcome.skipped;
        log(`[${stage}] skipped: ${outcome.skipped}`);
      } else {
        rec.state = "done";
        if (!doc.pipeline.stages_completed.includes(stage)) doc.pipeline.stages_completed.push(stage);
        log(`[${stage}] done${Object.keys(usage.usage).length ? ` (${describeUsage({ ...trackerTotals(usage.usage), cost_usd: usage.cost })})` : ""}`);
      }
      job.costUsd = round6(job.costUsd + usage.cost);
      await recordPipelineUsage(db, { itemId: item.id, namespaceId: namespace.id, jobId: job.id, stage, usage: usage.usage }).catch((e) => log(`[${stage}] usage ledger: ${String(e)}`));
      await saveDocument(storage, doc);
      await saveJob();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      rec.state = "failed";
      rec.error = message;
      rec.finished_at = nowIso();
      rec.usage = usage.usage;
      rec.cost_usd = usage.cost;
      job.costUsd = round6(job.costUsd + usage.cost);
      await recordPipelineUsage(db, { itemId: item.id, namespaceId: namespace.id, jobId: job.id, stage, usage: usage.usage }).catch(() => undefined);
      job.state = "failed";
      job.error = `${stage}: ${message}`;
      await saveDocument(storage, doc).catch(() => undefined);
      await saveJob();
      await db.update(items).set({ status: "failed", updatedAt: new Date() }).where(eq(items.id, item.id));
      log(`[${stage}] FAILED: ${message}`);
      throw err;
    }
  }

  job.state = "done";
  job.stage = null;
  doc.pipeline.usage = jobTotals(job); // the document carries what it cost to make
  await saveDocument(storage, doc);
  await saveJob();
  await db
    .update(items)
    .set({
      status: "ready",
      title: doc.title || item.title,
      channel: doc.channel || item.channel,
      language: doc.language,
      durationS: doc.duration_s,
      summary: doc.article?.summary ?? null,
      documentKey: documentKey(item.id),
      updatedAt: new Date(),
    })
    .where(eq(items.id, item.id));
  await db.insert(events).values({ id: newId("evt"), itemId: item.id, kind: "ingested" });

  // PRD §9: the namespace summary is regenerated after every 3rd ingest; its cost rides on this job.
  try {
    const refreshed = await maybeRefreshNamespaceSummary({ db, generate: (o, usage) => providers.generate(o, usage) }, namespace.id);
    if (refreshed) {
      job.costUsd = round6(job.costUsd + refreshed.cost);
      await saveJob();
      await recordPipelineUsage(db, { itemId: item.id, namespaceId: namespace.id, jobId: job.id, stage: "summary", source: "summary", usage: refreshed.usage }).catch(() => undefined);
      log(`namespace summary refreshed ($${refreshed.cost.toFixed(4)})`);
    }
  } catch (err) {
    log(`namespace summary failed: ${(err as Error).message}`);
  }

  // Derived artifacts are in storage; the raw download and scratch files are no longer needed.
  await storage.deletePrefix(rawPrefix(item.id)).catch((e) => log(`cleanup raw/: ${String(e)}`));
  await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  log(`ingest complete — ${describeUsage({ ...jobTotals(job), cost_usd: job.costUsd })}`);
  return job;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
