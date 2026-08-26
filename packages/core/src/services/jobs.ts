import { eq } from "drizzle-orm";
import { type Db, type Item, type Job, items, jobs } from "../db/index.ts";
import { STAGE_NAMES } from "../document.ts";

export type JobStatus = {
  job: Job;
  item: Pick<Item, "id" | "title" | "status" | "sourceUrl" | "namespaceId">;
  progress: { stage: string; state: string; cost_usd: number; reason?: string; error?: string }[];
};

export async function getJobStatus(db: Db, jobId: string): Promise<JobStatus | null> {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job) return null;
  const [item] = await db.select().from(items).where(eq(items.id, job.itemId));
  if (!item) return null;
  const progress = STAGE_NAMES.map((stage) => {
    const r = job.stages[stage];
    return { stage, state: r?.state ?? "pending", cost_usd: r?.cost_usd ?? 0, reason: r?.skipped_reason, error: r?.error };
  });
  return { job, item: { id: item.id, title: item.title, status: item.status, sourceUrl: item.sourceUrl, namespaceId: item.namespaceId }, progress };
}
