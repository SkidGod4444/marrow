import { XMLParser } from "fast-xml-parser";

// PRD §7: "RSS: per-namespace feed subscriptions for podcasts/blogs; podcast enclosures go through the full media pipeline."

export type FeedEntry = {
  id: string;
  title: string;
  /** Web link of the entry (episode page / blog post). */
  url: string;
  published_at: string | null;
  /** Media enclosure (podcasts): audio/video URL + MIME type. */
  enclosure: { url: string; type: string } | null;
  /** Full content when the feed carries it (content:encoded / Atom content), else summary/description. */
  content_html: string;
  author: string;
};

export type Feed = { title: string | null; site_url: string | null; entries: FeedEntry[] };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", cdataPropName: "#cdata", trimValues: true, processEntities: true });

const str = (v: unknown): string => {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return str(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return str(o["#cdata"] ?? o["#text"] ?? o["@_href"] ?? "");
  }
  return "";
};
const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const iso = (s: string): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** RSS 2.0 (incl. iTunes podcast feeds) and Atom. Entries in feed order (newest first in practice). */
export function parseFeed(xml: string): Feed {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const rss = doc.rss as { channel?: Record<string, unknown> } | undefined;
  if (rss?.channel) {
    const ch = rss.channel;
    const entries = arr(ch.item as Record<string, unknown> | Record<string, unknown>[] | undefined).map((it, i): FeedEntry => {
      const enc = arr(it.enclosure as Record<string, string> | Record<string, string>[] | undefined)[0];
      const media = enc?.["@_url"] ? { url: enc["@_url"], type: enc["@_type"] ?? "" } : null;
      const link = str(it.link) || str(it.guid) || media?.url || "";
      return {
        id: str(it.guid) || link || `${i}`,
        title: str(it.title),
        url: link,
        published_at: iso(str(it.pubDate) || str(it["dc:date"])),
        enclosure: media,
        content_html: str(it["content:encoded"]) || str(it.description) || str(it["itunes:summary"]),
        author: str(it["dc:creator"]) || str(it["itunes:author"]) || str(it.author),
      };
    });
    return { title: str(ch.title) || null, site_url: str(ch.link) || null, entries };
  }
  const feed = doc.feed as Record<string, unknown> | undefined;
  if (feed) {
    const linkOf = (links: unknown, rel?: string) => {
      const ls = arr(links as Record<string, string> | Record<string, string>[] | undefined);
      const l = rel ? ls.find((x) => x["@_rel"] === rel) : (ls.find((x) => !x["@_rel"] || x["@_rel"] === "alternate") ?? ls[0]);
      return l?.["@_href"] ?? "";
    };
    const entries = arr(feed.entry as Record<string, unknown> | Record<string, unknown>[] | undefined).map((e, i): FeedEntry => {
      const encLink = arr(e.link as Record<string, string> | Record<string, string>[] | undefined).find((x) => x["@_rel"] === "enclosure");
      const link = linkOf(e.link) || str(e.id);
      return {
        id: str(e.id) || link || `${i}`,
        title: str(e.title),
        url: link,
        published_at: iso(str(e.published) || str(e.updated)),
        enclosure: encLink?.["@_href"] ? { url: encLink["@_href"], type: encLink["@_type"] ?? "" } : null,
        content_html: str(e.content) || str(e.summary),
        author: str((e.author as Record<string, unknown> | undefined)?.name) || str(e.author),
      };
    });
    return { title: str(feed.title) || null, site_url: linkOf(feed.link) || null, entries };
  }
  throw new Error("not an RSS or Atom feed");
}

export function isMediaEnclosure(e: FeedEntry): boolean {
  return Boolean(e.enclosure && (/^(audio|video)\//i.test(e.enclosure.type) || /\.(mp3|m4a|aac|ogg|opus|wav|mp4|m4v|webm)(\?|$)/i.test(e.enclosure.url)));
}

export async function fetchFeed(url: string, opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}): Promise<Feed> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await (opts.fetchImpl ?? fetch)(url, { signal: ctrl.signal, redirect: "follow", headers: { "user-agent": "Marrow/0.1 (+feed reader)", accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5" } });
    if (!res.ok) throw new Error(`feed answered ${res.status}`);
    return parseFeed(await res.text());
  } finally {
    clearTimeout(timer);
  }
}
