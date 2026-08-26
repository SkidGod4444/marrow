/** Seconds → "MM:SS" (or "H:MM:SS" past an hour) — the citation format used everywhere (PRD §6.1). */
export function fmtTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Deep link to a moment: `{source_url}&t={int(t_start)}s` for YouTube (PRD §4.4). */
export function deepLink(sourceUrl: string, tStart: number | null | undefined): string {
  if (tStart === null || tStart === undefined) return sourceUrl;
  const t = Math.max(0, Math.floor(tStart));
  try {
    const u = new URL(sourceUrl);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com" || host === "youtu.be") {
      u.searchParams.set("t", `${t}s`);
      return u.toString();
    }
    u.hash = `t=${t}`;
    return u.toString();
  } catch {
    return `${sourceUrl}${sourceUrl.includes("?") ? "&" : "?"}t=${t}s`;
  }
}

/** "[MM:SS] text" lines — the static transcript prefix for chat context and LLM passes. */
export function transcriptLines(entries: Array<{ t_start: number; text: string }>): string {
  return entries.map((e) => `[${fmtTs(e.t_start)}] ${e.text.trim()}`).join("\n");
}
