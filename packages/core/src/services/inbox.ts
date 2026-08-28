import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { type Db, type Item, items, namespaces } from "../db/index.ts";
import { type JobProgress, jobProgress, latestJobsFor } from "./jobs.ts";
import { logEvent } from "./events.ts";
import { getNamespace } from "./namespaces.ts";

// PRD §6.4 watch inbox: ready items you haven't skipped, newest first, with summary + novelty verdict.

export type InboxEntry = Item & { namespace: { id: string; name: string }; job?: JobProgress };

export async function listInbox(db: Db, opts: { organizationId?: string; namespace?: string; includeArchived?: boolean; limit?: number } = {}): Promise<{ entries: InboxEntry[]; pending: InboxEntry[] }> {
  const ns = opts.namespace ? await getNamespace(db, opts.namespace, opts.organizationId) : null;
  if (opts.namespace && !ns) throw new Error(`namespace "${opts.namespace}" not found`);
  const scope = ns ? eq(items.namespaceId, ns.id) : opts.organizationId ? eq(namespaces.organizationId, opts.organizationId) : sql`true`;
  const rows = await db
    .select({ item: items, ns: { id: namespaces.id, name: namespaces.name } })
    .from(items)
    .innerJoin(namespaces, eq(namespaces.id, items.namespaceId))
    .where(and(scope, opts.includeArchived ? sql`true` : isNull(items.archivedAt), inArray(items.status, ["ready", "queued", "running", "failed"])))
    .orderBy(desc(items.createdAt))
    .limit(opts.limit ?? 100);
  const all: InboxEntry[] = rows.map((r) => ({ ...r.item, namespace: r.ns }));
  const pending = all.filter((e) => e.status !== "ready");
  if (pending.length) {
    // Latest job per pending item → step-by-step progress / error, so the UI can show what is happening and offer a retry.
    const latest = await latestJobsFor(db, pending.map((p) => p.id));
    for (const e of pending) {
      const j = latest.get(e.id);
      if (j) e.job = jobProgress(j);
    }
  }
  return { entries: all.filter((e) => e.status === "ready"), pending };
}

/** "Skip" archives the entry (and logs the `skipped` event, PRD §11); `archived = false` brings it back. */
export async function archiveItem(db: Db, itemId: string, archived = true, userId?: string): Promise<Item | null> {
  const [row] = await db.update(items).set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() }).where(eq(items.id, itemId)).returning();
  if (!row) return null;
  if (archived) await logEvent(db, itemId, "skipped", userId);
  return row;
}
