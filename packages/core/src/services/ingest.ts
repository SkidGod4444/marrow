import { and, desc, eq } from "drizzle-orm";
import { type Db, type Item, type Job, items, jobs } from "../db/index.ts";
import { type SourceType, newId, newItemId } from "../ids.ts";
import { canonicalizeSourceUrl } from "../media/ytdlp.ts";
import { getNamespace } from "./namespaces.ts";

export type IngestResult = { item: Item; job: Job; reused: boolean };

export function inferSourceType(url: string): SourceType {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^(www|m)\./, "");
    } catch {
      return "";
    }
  })();
  if (host === "youtube.com" || host === "youtu.be") return "youtube_video";
  throw new Error(`cannot infer source type for ${url}; only YouTube URLs are supported in Phase 1`);
}

/**
 * PRD §5 idempotency: one item per (namespace, source_url). A `ready` item is returned as-is unless `force`,
 * which starts a new job at version+1 (derived artifacts are replaced). A failed/queued item resumes its latest job.
 */
export async function createIngest(db: Db, input: { namespace: string; organizationId?: string; url: string; sourceType?: SourceType; force?: boolean }): Promise<IngestResult> {
  const ns = await getNamespace(db, input.namespace, input.organizationId);
  if (!ns) throw new Error(`namespace "${input.namespace}" not found`);
  const sourceUrl = canonicalizeSourceUrl(input.url);
  const sourceType = input.sourceType ?? inferSourceType(sourceUrl);

  const [existing] = await db.select().from(items).where(and(eq(items.namespaceId, ns.id), eq(items.sourceUrl, sourceUrl)));
  if (!existing) {
    const [item] = await db.insert(items).values({ id: newItemId(sourceType), namespaceId: ns.id, sourceType, sourceUrl, status: "queued" }).returning();
    const [job] = await db.insert(jobs).values({ id: newId("job"), itemId: item!.id, version: 1, state: "queued" }).returning();
    return { item: item!, job: job!, reused: false };
  }

  const [latest] = await db.select().from(jobs).where(eq(jobs.itemId, existing.id)).orderBy(desc(jobs.version), desc(jobs.createdAt)).limit(1);
  if (latest && latest.state !== "done") return { item: existing, job: latest, reused: true };
  if (latest && !input.force) return { item: existing, job: latest, reused: true };

  const version = (latest?.version ?? 0) + 1;
  const [job] = await db.insert(jobs).values({ id: newId("job"), itemId: existing.id, version, state: "queued" }).returning();
  await db.update(items).set({ status: "queued", updatedAt: new Date() }).where(eq(items.id, existing.id));
  return { item: { ...existing, status: "queued" }, job: job!, reused: false };
}
