import { and, eq, inArray } from "drizzle-orm";
import { type Db, type Source, items, sources } from "../db/index.ts";
import { newId } from "../ids.ts";
import { type PlaylistListing, canonicalizeSourceUrl } from "../media/ytdlp.ts";
import type { JobQueue } from "../queue.ts";
import { createIngest } from "./ingest.ts";
import { getNamespace } from "./namespaces.ts";

// PRD §6.4: subscribed playlists/channels are polled on a schedule; new uploads are ingested automatically.

export type SourceKind = "playlist" | "channel" | "rss" | "email";

export function inferSourceKind(url: string): SourceKind {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid URL: ${url}`);
  }
  const host = u.hostname.replace(/^(www|m)\./, "");
  if (host === "youtube.com") {
    if (u.searchParams.get("list")) return "playlist";
    if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/.test(u.pathname)) return "channel";
    throw new Error("YouTube URL must be a playlist (list=…) or a channel (/@handle, /channel/…)");
  }
  if (/\.(xml|rss|atom)$|\/feed\/?$|\/rss\/?$/i.test(u.pathname)) return "rss";
  throw new Error(`cannot infer a subscription kind for ${url} — pass kind explicitly`);
}

export function normalizeSourceUrl(url: string, kind: SourceKind): string {
  const u = new URL(url.trim());
  if (kind === "playlist") {
    const list = u.searchParams.get("list");
    if (list) return `https://www.youtube.com/playlist?list=${list}`;
  }
  if (kind === "channel") {
    const path = u.pathname.replace(/\/(videos|streams|shorts|featured)\/?$/, "").replace(/\/$/, "");
    return `https://www.youtube.com${path}`;
  }
  u.hash = "";
  return u.toString();
}

export async function addSource(db: Db, input: { namespace: string; url: string; kind?: SourceKind; title?: string }): Promise<{ source: Source; created: boolean }> {
  const ns = await getNamespace(db, input.namespace);
  if (!ns) throw new Error(`namespace "${input.namespace}" not found`);
  const kind = input.kind ?? inferSourceKind(input.url);
  const url = normalizeSourceUrl(input.url, kind);
  const [existing] = await db.select().from(sources).where(and(eq(sources.namespaceId, ns.id), eq(sources.url, url)));
  if (existing) return { source: existing, created: false };
  const [row] = await db.insert(sources).values({ id: newId("src"), namespaceId: ns.id, kind, url, title: input.title ?? null }).returning();
  return { source: row!, created: true };
}

export async function listSources(db: Db, namespaceId?: string): Promise<Source[]> {
  return namespaceId ? db.select().from(sources).where(eq(sources.namespaceId, namespaceId)) : db.select().from(sources);
}

export async function removeSource(db: Db, id: string): Promise<boolean> {
  const rows = await db.delete(sources).where(eq(sources.id, id)).returning({ id: sources.id });
  return rows.length > 0;
}

export type PollDeps = {
  db: Db;
  queue?: JobQueue;
  /** yt-dlp flat listing in production; a fake in tests. */
  listEntries: (url: string, kind: SourceKind) => Promise<PlaylistListing>;
  log?: (msg: string) => void;
};

export type PollResult = { source_id: string; found: number; queued: string[]; error: string | null };

/** Poll one source: list its entries, ingest the ones the namespace doesn't have yet, stamp last_checked_at. */
export async function pollSource(deps: PollDeps, source: Source): Promise<PollResult> {
  const { db } = deps;
  const result: PollResult = { source_id: source.id, found: 0, queued: [], error: null };
  try {
    if (source.kind === "rss" || source.kind === "email") throw new Error(`${source.kind} sources are polled from Phase 5`);
    const listing = await deps.listEntries(source.url, source.kind as SourceKind);
    result.found = listing.entries.length;
    const urls = listing.entries.map((e) => canonicalizeSourceUrl(e.url));
    const existing = urls.length ? await db.select({ url: items.sourceUrl }).from(items).where(and(eq(items.namespaceId, source.namespaceId), inArray(items.sourceUrl, urls))) : [];
    const have = new Set(existing.map((r) => r.url));
    for (const url of urls) {
      if (have.has(url)) continue;
      const res = await createIngest(db, { namespace: source.namespaceId, url });
      if (!res.reused || res.job.state !== "done") {
        await deps.queue?.enqueue(res.job.id);
        result.queued.push(res.job.id);
      }
      have.add(url);
    }
    await db.update(sources).set({ lastCheckedAt: new Date(), lastError: null, title: source.title ?? listing.title }).where(eq(sources.id, source.id));
    deps.log?.(`polled ${source.kind} ${source.url}: ${result.found} entries, ${result.queued.length} queued`);
  } catch (err) {
    result.error = (err as Error).message;
    await db.update(sources).set({ lastCheckedAt: new Date(), lastError: result.error }).where(eq(sources.id, source.id));
    deps.log?.(`poll failed for ${source.url}: ${result.error}`);
  }
  return result;
}

export async function pollAllSources(deps: PollDeps, namespaceId?: string): Promise<PollResult[]> {
  const out: PollResult[] = [];
  for (const s of await listSources(deps.db, namespaceId)) out.push(await pollSource(deps, s));
  return out;
}
