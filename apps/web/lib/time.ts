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
/** Streamdown drops relative links; internal `/items/…` citations are prefixed with a sentinel origin that MarkdownLink removes. */
export const INTERNAL_ORIGIN = "https://marrow.internal";
export function absolutizeInternalLinks(md: string): string {
  return md.replace(/\]\((\/(?:items|namespaces|library|graph)\b[^)\s]*)\)/g, (_, path: string) => `](${INTERNAL_ORIGIN}${path})`);
}

export function linkifyTimestamps(md: string): string {
  // Existing markdown links are left alone — a namespace citation `[Title @ 05:00](/items/…)` must not get a nested
  // `[05:00](#t=300)` inside its text, which breaks the link entirely.
  const keep: string[] = [];
  const shielded = md.replace(/\[[^\]\n]*\]\([^)\s]+\)/g, (m) => {
    keep.push(m);
    return `\uE000${keep.length - 1}\uE000`; // private-use sentinel, never in real text
  });
  const linked = shielded
    .replace(/\[((?:\d+:)?\d{1,2}:\d{2})\]/g, (_m, ts: string) => `[${ts}](#t=${parseTs(ts) ?? 0})`)
    .replace(/(^|[\s(])@\s?((?:\d+:)?\d{1,2}:\d{2})\b/g, (_m, pre: string, ts: string) => `${pre}[${ts}](#t=${parseTs(ts) ?? 0})`);
  return linked.replace(/\uE000(\d+)\uE000/g, (_m, i: string) => keep[Number(i)]!);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "4 Sep" (this year) or "4 Sep 2027" — UTC-deterministic like fmtDate, but for people rather than logs. `today` fixes the year reference in tests. */
export function fmtDay(value: string | Date | null | undefined, today: Date = new Date()): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === today.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

/** Deterministic YYYY-MM-DD in UTC — identical on the server and in the browser, so it never causes hydration mismatches. */
export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}
