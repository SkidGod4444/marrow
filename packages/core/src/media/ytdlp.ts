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

export async function fetchMetadata(cfg: Config, url: string): Promise<YtMeta> {
  const { stdout } = await exec(cfg.YTDLP_BIN, ["-J", "--no-playlist", "--no-warnings", url]);
  return JSON.parse(stdout) as YtMeta;
}

/** Download the best ≤ MAX_VIDEO_HEIGHT mp4 (video+audio) to `${outDir}/source.<ext>` and return the path. */
export async function download(cfg: Config, url: string, outDir: string): Promise<string> {
  const h = cfg.MAX_VIDEO_HEIGHT;
  const format = `bv*[height<=${h}][ext=mp4]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/b`;
  await exec(cfg.YTDLP_BIN, [
    "--no-playlist", "--no-warnings", "--no-progress", "-f", format, "--merge-output-format", "mp4",
    "-o", join(outDir, "source.%(ext)s"), url,
  ]);
  const files = await readdir(outDir);
  const src = files.find((f) => f.startsWith("source."));
  if (!src) throw new Error(`yt-dlp produced no source.* file in ${outDir}`);
  return join(outDir, src);
}

/** Canonical form so (namespace, source_url) idempotency survives playlist/tracking params. */
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
