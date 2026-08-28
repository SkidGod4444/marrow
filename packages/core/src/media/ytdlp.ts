import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { exec } from "./exec.ts";

export type YtChapter = { title: string; start_time: number; end_time: number };
export type YtMeta = {
  id: string;
  title: string;
  channel?: string;
  uploader?: string;
  upload_date?: string; // YYYYMMDD
  duration?: number;
  chapters?: YtChapter[] | null;
  webpage_url?: string;
  description?: string;
  extractor?: string;
};

/** Flags every yt-dlp call gets: cookies / proxy for hosts YouTube flags, plus anything the operator appends. */
export type YtdlpConfig = Pick<Config, "YTDLP_COOKIES" | "YTDLP_PROXY" | "YTDLP_EXTRA_ARGS" | "YTDLP_POT_PROVIDER_URL">;

export function ytdlpArgs(cfg: YtdlpConfig, jsRuntime: string | null = process.execPath): string[] {
  const out: string[] = [];
  // YouTube streams need yt-dlp's JS challenge solver, which needs a JS runtime; only Deno is enabled by default and a
  // bare box has none — "n challenge solving failed", only image formats. Bun is always here (it runs Marrow), so enable
  // it as a fallback; Deno, when installed (the Docker image has it), is preferred automatically.
  if (jsRuntime) out.push("--js-runtimes", `bun:${jsRuntime}`);
  if (cfg.YTDLP_COOKIES) out.push("--cookies", cfg.YTDLP_COOKIES);
  if (cfg.YTDLP_PROXY) out.push("--proxy", cfg.YTDLP_PROXY);
  if (cfg.YTDLP_POT_PROVIDER_URL) out.push("--extractor-args", `youtubepot-bgutilhttp:base_url=${cfg.YTDLP_POT_PROVIDER_URL.replace(/\/$/, "")}`);
  if (cfg.YTDLP_EXTRA_ARGS?.trim()) out.push(...cfg.YTDLP_EXTRA_ARGS.trim().split(/\s+/));
  return out;
}

export const isBotCheck = (message: string) => /confirm you.re not a bot/i.test(message);

/** yt-dlp's stderr in a sentence a person can act on; the raw text stays in the log. */
export function explainYtdlpError(message: string, opts: { hasCookies?: boolean } = {}): string {
  if (isBotCheck(message))
    return opts.hasCookies
      ? "YouTube rejected this server's session just now — it flags cloud addresses even with cookies, usually for a minute or two. Retry; if it keeps happening, export a fresh cookies file (docs/DEPLOY.md → \"YouTube blocks the server\")."
      : "YouTube is asking this server to sign in — it flags cloud addresses. Give yt-dlp a cookies file or a proxy (docs/DEPLOY.md → \"YouTube blocks the server\"), then retry.";
  if (/Private video|Video unavailable|has been removed|This video is not available/i.test(message)) return "This video is private, removed or not available where the server is.";
  if (/HTTP Error 429|Too Many Requests/i.test(message)) return "YouTube is rate-limiting this server — try again in a while.";
  if (/is not a valid URL|Unsupported URL/i.test(message)) return "That link isn't something yt-dlp can download.";
  if (/members-only|Join this channel/i.test(message)) return "This video is members-only.";
  return message;
}

const explained = (cfg: YtdlpConfig, err: unknown): Error => {
  const raw = err instanceof Error ? err.message : String(err);
  const plain = explainYtdlpError(raw, { hasCookies: Boolean(cfg.YTDLP_COOKIES) });
  return plain === raw ? (err as Error) : new Error(plain, { cause: err });
};

/**
 * YouTube's bot check on cloud addresses comes and goes — the same request, same cookies, passes a minute later
 * (the failing run refreshes the session cookies). So a bot check is retried a couple of times before it fails the
 * stage; the broker's own retries (30 s apart) sit on top of this.
 */
export async function withBotCheckRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; delaysMs?: number[]; sleep?: (ms: number) => Promise<void>; onRetry?: (attempt: number, err: Error) => void } = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const delays = opts.delaysMs ?? [20_000, 40_000];
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isBotCheck(message) || i >= attempts - 1) throw err;
      opts.onRetry?.(i + 1, err as Error);
      await sleep(delays[Math.min(i, delays.length - 1)] ?? 20_000);
    }
  }
}

export async function fetchMetadata(cfg: Config, url: string, opts: { log?: (m: string) => void } = {}): Promise<YtMeta> {
  try {
    const { stdout } = await withBotCheckRetry(() => exec(cfg.YTDLP_BIN, ["-J", "--no-playlist", "--no-warnings", ...ytdlpArgs(cfg), url]), {
      onRetry: (n) => opts.log?.(`YouTube bot check on metadata — retrying (${n}/2)`),
    });
    return JSON.parse(stdout) as YtMeta;
  } catch (err) {
    opts.log?.(`yt-dlp: ${(err instanceof Error ? err.message : String(err)).slice(-300)}`);
    throw explained(cfg, err);
  }
}

/** Download the best ≤ MAX_VIDEO_HEIGHT mp4 (video+audio) to `${outDir}/source.<ext>` and return the path. */
export async function download(cfg: Config, url: string, outDir: string, opts: { log?: (m: string) => void } = {}): Promise<string> {
  const h = cfg.MAX_VIDEO_HEIGHT;
  const format = `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`;
  try {
    await withBotCheckRetry(
      () =>
        exec(cfg.YTDLP_BIN, [
          "--no-playlist", "--no-warnings", "--no-progress", "-f", format, "--merge-output-format", "mp4",
          ...ytdlpArgs(cfg),
          "-o", join(outDir, "source.%(ext)s"), url,
        ]),
      { onRetry: (n) => opts.log?.(`YouTube bot check on download — retrying (${n}/2)`) },
    );
  } catch (err) {
    opts.log?.(`yt-dlp: ${(err instanceof Error ? err.message : String(err)).slice(-300)}`);
    throw explained(cfg, err);
  }
  const files = await readdir(outDir);
  const src = files.find((f) => f.startsWith("source."));
  if (!src) throw new Error(`yt-dlp produced no source.* file in ${outDir}`);
  return join(outDir, src);
}

export type PlaylistEntry = { id: string; title: string; url: string };
export type PlaylistListing = { title: string | null; entries: PlaylistEntry[] };

/** Newest-first listing of a playlist or channel without downloading anything (`--flat-playlist`). */
export async function listPlaylistEntries(cfg: Config, url: string, opts: { limit?: number } = {}): Promise<PlaylistListing> {
  const target = channelVideosUrl(url);
  const limit = opts.limit ?? 100;
  const { stdout } = await exec(cfg.YTDLP_BIN, ["-J", "--flat-playlist", "--no-warnings", "--playlist-end", String(limit), ...ytdlpArgs(cfg), target]);
  const j = JSON.parse(stdout) as { title?: string; entries?: Array<{ id?: string; title?: string; url?: string; _type?: string; entries?: unknown[] }> };
  const entries: PlaylistEntry[] = [];
  for (const e of j.entries ?? []) {
    if (!e.id || e._type === "playlist") continue;
    entries.push({ id: e.id, title: e.title ?? "", url: `https://www.youtube.com/watch?v=${e.id}` });
  }
  return { title: j.title ?? null, entries };
}

/** Channel URLs list tabs; `/videos` lists uploads newest-first, which is what polling wants. */
export function channelVideosUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (host !== "youtube.com") return url;
    if (u.searchParams.get("list")) return url;
    if (/^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(u.pathname)) return `https://www.youtube.com${u.pathname.replace(/\/$/, "")}/videos`;
    return url;
  } catch {
    return url;
  }
}

/** Canonical form so (namespace, source_url) idempotency survives playlist/tracking params. */
export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^(www|m|music)\./, "");
    return host === "youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

export function canonicalizeSourceUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    const host = u.hostname.replace(/^(www|m)\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    if (host === "youtube.com") {
      const id = u.searchParams.get("v") ?? (u.pathname.startsWith("/shorts/") || u.pathname.startsWith("/live/") ? u.pathname.split("/")[2] : null);
      if (id) return `https://www.youtube.com/watch?v=${id}`;
    }
    u.hash = "";
    const tracking = Array.from(u.searchParams.keys()).filter((k) => /^utm_|^fbclid$|^si$/.test(k));
    for (const k of tracking) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return url.trim();
  }
}

export function publishedAtFromUploadDate(d?: string): Date | null {
  if (!d || !/^\d{8}$/.test(d)) return null;
  return new Date(`${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00Z`);
}
