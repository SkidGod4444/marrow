import { and, eq, inArray } from "drizzle-orm";
import { type Feed, type FeedEntry, fetchFeed, isMediaEnclosure } from "../capture/feeds.ts";
import { type PageContent, htmlFragmentToMarkdown } from "../capture/page.ts";
import { type Db, type Source, items, sources } from "../db/index.ts";
import { newId } from "../ids.ts";
import { type PlaylistListing, canonicalizeSourceUrl } from "../media/ytdlp.ts";
import type { JobQueue } from "../queue.ts";
import type { Storage } from "../storage/index.ts";
import { createCapture } from "./capture.ts";
import { createIngest } from "./ingest.ts";
import { setItemMetadata } from "./items.ts";
import { getNamespace } from "./namespaces.ts";

// PRD §6.4: subscribed playlists/channels are polled on a schedule; new uploads are ingested automatically.
// PRD §7: RSS feeds too — podcast enclosures go through the media pipeline, blog entries are captured as text.

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

export async function addSource(db: Db, input: { namespace: string; organizationId?: string; url: string; kind?: SourceKind; title?: string }): Promise<{ source: Source; created: boolean }> {
  const ns = await getNamespace(db, input.namespace, input.organizationId);
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
  /** RSS/Atom polling (PRD §7). `storage` + `fetchPage` seed captured documents; both injectable for tests. */
  storage?: Storage;
  fetchFeed?: (url: string) => Promise<Feed>;
  fetchPage?: (url: string) => Promise<PageContent>;
  /** New feed entries ingested per poll (config FEED_MAX_PER_POLL). */
  maxPerPoll?: number;
  log?: (msg: string) => void;
};

export type PollResult = { source_id: string; found: number; queued: string[]; error: string | null };

/** Poll one source: list its entries, ingest the ones the namespace doesn't have yet, stamp last_checked_at. */
export async function pollSource(deps: PollDeps, source: Source): Promise<PollResult> {
  const { db } = deps;
  const result: PollResult = { source_id: source.id, found: 0, queued: [], error: null };
  try {
    if (source.kind === "rss") return await pollFeed(deps, source, result);
    if (source.kind === "email") throw new Error("email sources are not polled — mails arrive through the inbound webhook");
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

/** One feed poll: newest entries first, skip what the namespace already has, at most `maxPerPoll` new ones. */
async function pollFeed(deps: PollDeps, source: Source, result: PollResult): Promise<PollResult> {
  const { db } = deps;
  if (!deps.storage) throw new Error("feed polling needs storage");
  const feed = await (deps.fetchFeed ?? fetchFeed)(source.url);
  result.found = feed.entries.length;
  const candidates = feed.entries.filter((e) => e.url || e.enclosure?.url);
  const urls = candidates.flatMap((e) => [e.url, e.enclosure?.url].filter((u): u is string => Boolean(u)).map(canonicalizeSourceUrl));
  const existing = urls.length ? await db.select({ url: items.sourceUrl }).from(items).where(and(eq(items.namespaceId, source.namespaceId), inArray(items.sourceUrl, urls))) : [];
  const have = new Set(existing.map((r) => r.url));
  const max = deps.maxPerPoll ?? 5;
  let skipped = 0;
  for (const entry of candidates) {
    const key = canonicalizeSourceUrl(isMediaEnclosure(entry) ? entry.enclosure!.url : entry.url);
    if (have.has(key) || (entry.url && have.has(canonicalizeSourceUrl(entry.url)))) continue;
    if (result.queued.length >= max) {
      skipped++;
      continue;
    }
    try {
      const jobId = await ingestFeedEntry(deps, source, feed, entry);
      if (jobId) result.queued.push(jobId);
      have.add(key);
    } catch (err) {
      deps.log?.(`feed entry skipped (${entry.title || entry.url}): ${(err as Error).message}`);
    }
  }
  await db.update(sources).set({ lastCheckedAt: new Date(), lastError: null, title: source.title ?? feed.title }).where(eq(sources.id, source.id));
  deps.log?.(`polled feed ${source.url}: ${result.found} entries, ${result.queued.length} queued${skipped ? `, ${skipped} left for the next poll` : ""}`);
  return result;
}

async function ingestFeedEntry(deps: PollDeps, source: Source, feed: Feed, entry: FeedEntry): Promise<string | null> {
  const { db } = deps;
  const published = entry.published_at ? new Date(entry.published_at) : null;
  if (isMediaEnclosure(entry)) {
    // Podcast episode: the media pipeline (transcribe → diarize → article …) on the enclosure; feed metadata on the item.
    const res = await createIngest(db, { namespace: source.namespaceId, url: entry.enclosure!.url, sourceType: "podcast_episode" });
    if (res.reused && res.job.state === "done") return null;
    await setItemMetadata(db, res.item.id, { title: entry.title || res.item.title, channel: feed.title ?? entry.author ?? "", publishedAt: published });
    await deps.queue?.enqueue(res.job.id);
    return res.job.id;
  }
  // Blog/newsletter entry: full content from the feed when it carries it, else the page is fetched.
  const md = entry.content_html ? htmlFragmentToMarkdown(entry.content_html) : "";
  const res = await createCapture(
    { db, storage: deps.storage!, queue: deps.queue, fetchPage: deps.fetchPage ?? (() => Promise.reject(new Error("page fetching is not available"))) },
    { namespace: source.namespaceId, url: entry.url, text: md.length >= 500 ? md : undefined, title: entry.title || undefined, author: entry.author || feed.title || undefined, published_at: entry.published_at },
  );
  return res.reused ? null : res.job.id;
}

export async function pollAllSources(deps: PollDeps, namespaceId?: string): Promise<PollResult[]> {
  const out: PollResult[] = [];
  for (const s of await listSources(deps.db, namespaceId)) out.push(await pollSource(deps, s));
  return out;
}
