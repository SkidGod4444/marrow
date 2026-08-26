import type { Chapter, Frame } from "../document.ts";

export type SegInput = { t_start: number | null; t_end: number | null; text: string };
export type SegOutput = { t_start: number | null; t_end: number | null; text: string; frame_ids: string[] };

const SENTENCE_END = /[.!?…]["')\]]?$/;

/**
 * PRD §4.4: ~200–400 tokens per segment (≈ 4 chars/token), split on sentence + chapter boundaries.
 * `frame_ids` = frames whose timestamp falls inside the segment span.
 */
export function buildSegments(
  entries: SegInput[],
  opts: { chapters?: Chapter[]; frames?: Frame[]; targetChars?: number; maxChars?: number } = {},
): SegOutput[] {
  const target = opts.targetChars ?? 1200;
  const max = opts.maxChars ?? 1600;
  const boundaries = (opts.chapters ?? []).map((c) => c.t_start).filter((t) => t > 0).sort((a, b) => a - b);
  const chapterIndex = (t: number | null) => (t === null ? -1 : boundaries.filter((b) => b <= t).length);

  const out: SegOutput[] = [];
  let buf: SegInput[] = [];
  let chars = 0;

  const flush = () => {
    if (!buf.length) return;
    const t_start = buf[0]!.t_start;
    const t_end = buf[buf.length - 1]!.t_end;
    out.push({ t_start, t_end, text: buf.map((e) => e.text.trim()).filter(Boolean).join(" "), frame_ids: [] });
    buf = [];
    chars = 0;
  };

  for (const entry of entries) {
    const text = entry.text.trim();
    if (!text) continue;
    if (buf.length && entry.t_start !== null && chapterIndex(entry.t_start) !== chapterIndex(buf[0]!.t_start)) flush();
    if (chars + text.length > max && buf.length) flush();
    buf.push(entry);
    chars += text.length + 1;
    if (chars >= max || (chars >= target && SENTENCE_END.test(text))) flush();
  }
  flush();

  if (opts.frames?.length) {
    for (const seg of out) {
      if (seg.t_start === null || seg.t_end === null) continue;
      seg.frame_ids = opts.frames.filter((f) => f.t >= seg.t_start! && f.t <= seg.t_end!).map((f) => f.id);
    }
  }
  return out;
}

/** Text sources (captured posts, newsletters, papers): paragraphs become untimed entries. */
export function paragraphsToEntries(text: string): SegInput[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((p) => ({ t_start: null, t_end: null, text: p }));
}
