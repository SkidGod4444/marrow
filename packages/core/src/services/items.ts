import { and, desc, eq } from "drizzle-orm";
import { type Db, type Item, items } from "../db/index.ts";

export async function getItem(db: Db, id: string): Promise<Item | null> {
  const [row] = await db.select().from(items).where(eq(items.id, id));
  return row ?? null;
}

/** Metadata known before the pipeline runs (feed title/author/date for a podcast episode); the fetch stage keeps it for direct media. */
export async function setItemMetadata(db: Db, id: string, meta: { title?: string; channel?: string; publishedAt?: Date | null }): Promise<void> {
  await db.update(items).set({ ...meta, updatedAt: new Date() }).where(eq(items.id, id));
}

export async function listItems(db: Db, namespaceId: string, status?: string): Promise<Item[]> {
  const where = status ? and(eq(items.namespaceId, namespaceId), eq(items.status, status)) : eq(items.namespaceId, namespaceId);
  return db.select().from(items).where(where).orderBy(desc(items.createdAt));
}
