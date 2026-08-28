import { desc, eq, inArray } from "drizzle-orm";
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
