import { canonicalizeSourceUrl } from "../media/ytdlp.ts";

const YT_RE = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s)\]"']*v=|shorts\/|live\/)|youtu\.be\/)[\w-]{11}[^\s)\]"'<>]*/g;

/** YouTube video links inside captured text/links (PRD §7: "offer/auto-queue that video for full ingestion"). */
export function extractYouTubeUrls(...sources: Array<string | string[] | undefined>): string[] {
  const out = new Set<string>();
  for (const s of sources) {
    for (const piece of Array.isArray(s) ? s : [s ?? ""]) {
      for (const m of piece.matchAll(YT_RE)) out.add(canonicalizeSourceUrl(m[0]));
    }
  }
  return [...out].filter((u) => /watch\?v=[\w-]{11}$/.test(u));
}
