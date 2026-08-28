import { and, desc, eq } from "drizzle-orm";
import { type JobProgress, jobProgress, latestJobsFor } from "./jobs.ts";
import { usageByItem } from "./usage.ts";
import { type Db, type Item, items } from "../db/index.ts";

export async function getItem(db: Db, id: string): Promise<Item | null> {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  return row ?? null;
}

/** Metadata known before the pipeline runs (feed title/author/date for a podcast episode); the fetch stage keeps it for direct media. */
export async function setItemMetadata(db: Db, id: string, meta: { title?: string; channel?: string; publishedAt?: Date | null }): Promise<void> {
  await db.update(items).set({ ...meta, updatedAt: new Date() }).where(eq(items.id, id));
}

export type ItemWithJob = Item & { job?: JobProgress; usage?: { cost_usd: number; tokens: number } };

/** Items of a namespace, newest first; the ones still in flight (or failed) carry their latest job's progress. */
export async function listItems(db: Db, namespaceId: string, status?: string): Promise<ItemWithJob[]> {
  const where = status ? and(eq(items.namespaceId, namespaceId), eq(items.status, status)) : eq(items.namespaceId, namespaceId);
  const rows: ItemWithJob[] = await db.select().from(items).where(where).orderBy(desc(items.createdAt));
  const pending = rows.filter((r) => r.status !== "ready");
  if (pending.length) {
    const latest = await latestJobsFor(db, pending.map((p) => p.id));
    for (const r of pending) {
      const j = latest.get(r.id);
      if (j) r.job = jobProgress(j);
    }
  }
  const spend = await usageByItem(db, rows.map((r) => r.id));
  for (const r of rows) {
    const u = spend.get(r.id);
    if (u) r.usage = u;
  }
  return rows;
}
