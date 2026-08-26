// Client-safe timestamp helpers (mirrors packages/core/src/timefmt.ts without pulling core into the bundle).

export function fmtTs(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function parseTs(ts: string): number | null {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(ts.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Turn timestamp citations in assistant markdown — `[12:34]`, `[1:02:03]`, `@ 12:34` — into links (`#t=754`)
 * that the chat panel intercepts to seek the player (PRD §14 Phase 3).
 */
export function linkifyTimestamps(md: string): string {
  return md
    .replace(/\[((?:\d+:)?\d{1,2}:\d{2})\](?!\()/g, (_m, ts: string) => `[${ts}](#t=${parseTs(ts) ?? 0})`)
    .replace(/(^|[\s(])@\s?((?:\d+:)?\d{1,2}:\d{2})\b/g, (_m, pre: string, ts: string) => `${pre}[${ts}](#t=${parseTs(ts) ?? 0})`);
}
