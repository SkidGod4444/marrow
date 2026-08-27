import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { extractText, getDocumentProxy, getMeta } from "unpdf";

// PRD §7: "fetch page text server-side (plain fetch, no login, no automation against platforms)".
// One HTTP GET with a browser-ish UA, a size cap and a timeout; HTML → Readability → markdown, PDF → text.

export type PageContent = {
  url: string;
  final_url: string;
  content_type: "html" | "pdf" | "text";
  title: string;
  author: string;
  site_name: string;
  description: string;
  published_at: string | null;
  /** Readable body as markdown (HTML/PDF converted). */
  body_md: string;
  /** Absolute hrefs found in the readable body (HTML only). */
  links: string[];
};

export type FetchPageOptions = { timeoutMs?: number; maxBytes?: number; userAgent?: string; fetchImpl?: typeof fetch };

const DROP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "IFRAME", "SVG"]);
const SOCIAL_HOSTS = /(^|\.)(x\.com|twitter\.com|linkedin\.com|facebook\.com|instagram\.com|threads\.net)$/i;

/** Platforms the PRD forbids scraping: the owner pastes the post text instead (share-sheet "text + link"). */
export function isSocialUrl(url: string): boolean {
  try {
    return SOCIAL_HOSTS.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Only public http(s) hosts — never loopback/link-local/private ranges (the API key protects the endpoint, but a plain fetch of an attacker-chosen URL must not reach the VPC). */
export function assertPublicHttpUrl(url: string): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error("not a valid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("only http(s) URLs can be captured");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host === "metadata.google.internal") throw new Error("that host is not reachable from here");
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) throw new Error("that host is not reachable from here");
  }
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) throw new Error("that host is not reachable from here");
  return u;
}

/** arXiv abstract pages resolve to the PDF so papers get the full text, not the abstract card. */
export function normalizeCaptureUrl(url: string): string {
  try {
    const u = new URL(url);
    if (/(^|\.)arxiv\.org$/.test(u.hostname)) {
      const m = u.pathname.match(/^\/(abs|pdf|html)\/([\w.\-/]+?)(v\d+)?(\.pdf)?$/);
      if (m) return `https://arxiv.org/pdf/${m[2]}${m[3] ?? ""}`;
    }
    u.hash = "";
    for (const k of Array.from(u.searchParams.keys())) if (/^utm_|^fbclid$|^gclid$|^ref$/.test(k)) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url;
  }
}

export function looksLikePaper(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)(arxiv\.org|biorxiv\.org|medrxiv\.org|openreview\.net|aclanthology\.org|semanticscholar\.org|dl\.acm\.org|ieeexplore\.ieee\.org)$/.test(u.hostname) || /\.pdf$/i.test(u.pathname);
  } catch {
    return false;
  }
}

export async function fetchPage(url: string, opts: FetchPageOptions = {}): Promise<PageContent> {
  const target = assertPublicHttpUrl(url);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024;
  const f = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await f(target.toString(), {
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "user-agent": opts.userAgent ?? "Mozilla/5.0 (compatible; Marrow/0.1; +https://github.com/SkidGod4444/marrow)",
        accept: "text/html,application/xhtml+xml,application/pdf,text/plain;q=0.9,*/*;q=0.5",
        "accept-language": "en",
      },
    });
  } catch (err) {
    clearTimeout(timer);
    throw new Error(ctrl.signal.aborted ? "the page took too long to respond" : `could not reach the page (${(err as Error).message})`, { cause: err });
  }
  let bytes: Uint8Array;
  try {
    if (!res.ok) throw new Error(`the page answered ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > maxBytes) throw new Error("the page is too large to capture");
    bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error("the page is too large to capture");
  } finally {
    clearTimeout(timer);
  }
  const finalUrl = res.url || target.toString();
  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const isPdf = ct.includes("application/pdf") || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46); // %PDF
  if (isPdf) return pdfToContent(bytes, url, finalUrl);
  const text = new TextDecoder(charsetOf(ct) as never).decode(bytes);
  if (ct.includes("text/html") || ct.includes("xhtml") || /^\s*<(!doctype|html)/i.test(text)) return htmlToContent(text, url, finalUrl);
  const body = text.trim();
  return { url, final_url: finalUrl, content_type: "text", title: firstLine(body) || finalUrl, author: "", site_name: hostOf(finalUrl), description: "", published_at: null, body_md: body, links: [] };
}

function charsetOf(ct: string): string {
  const m = ct.match(/charset=([\w-]+)/);
  try {
    return m ? new TextDecoder(m[1] as never).encoding : "utf-8";
  } catch {
    return "utf-8";
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
const firstLine = (s: string) => (s.split(/\n/).map((l) => l.trim()).find(Boolean) ?? "").slice(0, 200);

export function htmlToContent(html: string, url: string, finalUrl = url): PageContent {
  const { document } = parseHTML(html);
  const meta = (name: string) => (document.querySelector(`meta[property="${name}"], meta[name="${name}"]`) as { getAttribute(n: string): string | null } | null)?.getAttribute("content")?.trim() ?? "";
  const article = new Readability(document as never, { charThreshold: 200 }).parse();
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove((node) => DROP_TAGS.has(node.nodeName));
  let body_md = article?.content ? td.turndown(article.content) : "";
  if (!body_md.trim()) {
    // Readability found no article-like block (short posts, docs pages) — fall back to the body text.
    const b = document.querySelector("main, article, body") as { textContent: string | null } | null;
    body_md = (b?.textContent ?? "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  const links = new Set<string>();
  const scope = article?.content ? parseHTML(`<div>${article.content}</div>`).document : document;
  for (const a of scope.querySelectorAll("a[href]") as Iterable<{ getAttribute(n: string): string | null }>) {
    const href = a.getAttribute("href");
    if (!href) continue;
    try {
      const abs = new URL(href, finalUrl);
      if (abs.protocol === "http:" || abs.protocol === "https:") links.add(abs.toString());
    } catch {
      /* ignore */
    }
  }
  const title = (article?.title || meta("og:title") || document.querySelector("title")?.textContent || "").trim() || finalUrl;
  const published = meta("article:published_time") || meta("og:updated_time") || meta("date") || article?.publishedTime || "";
  return {
    url,
    final_url: finalUrl,
    content_type: "html",
    title,
    author: (meta("author") || article?.byline || meta("article:author") || "").replace(/^by\s+/i, "").trim().slice(0, 200),
    site_name: (article?.siteName || meta("og:site_name") || hostOf(finalUrl)).trim(),
    description: (meta("description") || meta("og:description") || article?.excerpt || "").trim().slice(0, 1000),
    published_at: toIso(published),
    body_md: body_md.trim(),
    links: [...links].slice(0, 500),
  };
}

/** Feed `content:encoded` / email HTML → markdown (no Readability pass: the fragment is already the article). */
export function htmlFragmentToMarkdown(html: string): string {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-" });
  td.remove((node) => DROP_TAGS.has(node.nodeName));
  return td.turndown(html).replace(/\n{3,}/g, "\n\n").trim();
}

export async function pdfToContent(bytes: Uint8Array, url: string, finalUrl = url): Promise<PageContent> {
  const proxy = await getDocumentProxy(bytes);
  const meta = await getMeta(proxy).catch(() => ({ info: {} as Record<string, unknown> }));
  const { text } = await extractText(proxy, { mergePages: true });
  const info = (meta.info ?? {}) as { Title?: string; Author?: string; CreationDate?: string };
  const body = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return {
    url,
    final_url: finalUrl,
    content_type: "pdf",
    title: (info.Title?.trim() || firstLine(body) || finalUrl).slice(0, 300),
    author: (info.Author ?? "").trim().slice(0, 200),
    site_name: hostOf(finalUrl),
    description: "",
    published_at: null,
    body_md: body,
    links: [],
  };
}

function toIso(s: string): string | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
