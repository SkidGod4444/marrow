import { desc, eq, inArray, sql } from "drizzle-orm";
import { type Db, type Item, type Job, type StageRecord, items, jobs } from "../db/index.ts";
import { STAGE_NAMES, type StageName } from "../document.ts";

export type JobStatus = {
  job: Job;
  item: Pick<Item, "id" | "title" | "status" | "sourceUrl" | "namespaceId">;
  progress: { stage: string; state: string; cost_usd: number; reason?: string; error?: string }[];
  timeline: JobProgress;
};

/** What a person needs to see progress: which step is running, which are done/skipped, and since when. */
export type JobProgress = {
  id: string;
  state: string; // queued | running | failed | done
  stage: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  steps: { stage: StageName; state: StageRecord["state"] | "pending"; started_at?: string; finished_at?: string; reason?: string }[];
};

export function jobProgress(job: Job): JobProgress {
  return {
    id: job.id,
    state: job.state,
    stage: job.stage,
    error: job.error,
    created_at: job.createdAt.toISOString(),
    updated_at: job.updatedAt.toISOString(),
    steps: STAGE_NAMES.map((stage) => {
      const r = job.stages[stage];
      return { stage, state: r?.state ?? "pending", started_at: r?.started_at, finished_at: r?.finished_at, reason: r?.skipped_reason };
    }),
  };
}

/**
 * At boot: re-send every job the table still calls queued or running. Those were in flight (or waiting) when the previous
 * process stopped; nothing else will ever pick them up. The broker de-duplicates (singletonKey), and the runner resumes
 * at the interrupted stage, so this is safe to call on every start.
 */
export async function recoverJobs(db: Db, queue: { enqueue(jobId: string): Promise<void> }, log?: (m: string) => void): Promise<string[]> {
  const rows = await db.select({ id: jobs.id, state: jobs.state }).from(jobs).where(inArray(jobs.state, ["queued", "running"])).orderBy(jobs.createdAt);
  for (const r of rows) await queue.enqueue(r.id);
  if (rows.length) log?.(`re-queued ${rows.length} job(s) left ${rows.map((r) => r.state).join("/")} by the previous process`);
  return rows.map((r) => r.id);
}

/**
 * A job whose handler threw outside the stage loop — before the first stage (storage credentials missing, a row gone)
 * or around it — would stay "queued"/"running" forever with the reason only in the broker's table. Record it on the
 * job and the item so the card says "failed" with the reason and offers Retry. Returns false if the runner already did.
 */
export async function failJobIfUnstarted(db: Db, jobId: string, err: unknown): Promise<boolean> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job || job.state === "failed" || job.state === "done") return false;
  const message = err instanceof Error ? err.message : String(err);
  await db.update(jobs).set({ state: "failed", error: `${job.stage ?? "start"}: ${message}`, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  await db.update(items).set({ status: "failed", updatedAt: new Date() }).where(eq(items.id, job.itemId));
  return true;
}

/** Queue health for GET /health: how much is waiting, how much is running, and for how long. */
export type QueueStats = { queued: number; running: number; failed: number; oldest_queued_s: number | null; running_since_progress_s: number | null };
export async function queueStats(db: Db): Promise<QueueStats> {
  const rows = (await db
    .select({ state: jobs.state, n: sql<number>`count(*)::int`, oldestCreated: sql<string | null>`min(${jobs.createdAt})`, oldestUpdated: sql<string | null>`min(${jobs.updatedAt})` })
    .from(jobs)
    .where(inArray(jobs.state, ["queued", "running", "failed"]))
    .groupBy(jobs.state)) as Array<{ state: string; n: number; oldestCreated: string | Date | null; oldestUpdated: string | Date | null }>;
  const by = Object.fromEntries(rows.map((r) => [r.state, r])) as Record<string, (typeof rows)[number] | undefined>;
  const ago = (t: string | Date | null | undefined) => (t ? Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000)) : null);
  return {
    queued: by.queued?.n ?? 0,
    running: by.running?.n ?? 0,
    failed: by.failed?.n ?? 0,
    oldest_queued_s: ago(by.queued?.oldestCreated),
    running_since_progress_s: ago(by.running?.oldestUpdated),
  };
}

/** The most recent job of each item (one query), for lists that show in-flight status. */
export async function latestJobsFor(db: Db, itemIds: string[]): Promise<Map<string, Job>> {
  const out = new Map<string, Job>();
  if (itemIds.length === 0) return out;
  const rows = await db.select().from(jobs).where(inArray(jobs.itemId, itemIds)).orderBy(desc(jobs.createdAt));
  for (const j of rows) if (!out.has(j.itemId)) out.set(j.itemId, j);
  return out;
}

export async function getJobStatus(db: Db, jobId: string): Promise<JobStatus | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return null;
  const [item] = await db.select().from(items).where(eq(items.id, job.itemId));
  if (!item) return null;
  const progress = STAGE_NAMES.map((stage) => {
    const r = job.stages[stage];
    return { stage, state: r?.state ?? "pending", cost_usd: r?.cost_usd ?? 0, reason: r?.skipped_reason, error: r?.error };
  });
  return { job, item: { id: item.id, title: item.title, status: item.status, sourceUrl: item.sourceUrl, namespaceId: item.namespaceId }, progress, timeline: jobProgress(job) };
}
