import type { TranscriptEntry, Word } from "../document.ts";
import type { DiarSegment } from "../openai/diarize.ts";

// Pure helpers for speaker attribution: map diarized (speaker, start, end) spans onto the word-timestamped
// transcript, split entries where the speaker changes, and normalise labels to S1, S2, … by first appearance.

function speakerAt(segs: DiarSegment[], t: number): string | null {
  // segs sorted by start; pick the segment containing t, else the nearest one within 1.5 s.
  let lo = 0;
  let hi = segs.length - 1;
  let best: DiarSegment | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const s = segs[mid]!;
    if (t < s.start) hi = mid - 1;
    else if (t > s.end) lo = mid + 1;
    else return s.speaker;
  }
  for (const i of [hi, lo]) {
    const s = segs[i];
    if (!s) continue;
    const d = t < s.start ? s.start - t : t - s.end;
    if (d <= 1.5 && (!best || d < Math.abs(t - (t < best.start ? best.start : best.end)))) best = s;
  }
  return best?.speaker ?? null;
}

function overlapSpeaker(segs: DiarSegment[], t0: number, t1: number): string | null {
  const acc = new Map<string, number>();
  for (const s of segs) {
    const o = Math.min(t1, s.end) - Math.max(t0, s.start);
    if (o > 0) acc.set(s.speaker, (acc.get(s.speaker) ?? 0) + o);
  }
  let best: string | null = null;
  let bestV = 0;
  for (const [k, v] of acc) if (v > bestV) [best, bestV] = [k, v];
  return best;
}

/** Split/relabel transcript entries by diarized speaker spans. Entries without words are labelled by overlap. */
export function alignSpeakers(entries: TranscriptEntry[], diar: DiarSegment[]): { entries: TranscriptEntry[]; speakerIds: string[] } {
  const segs = [...diar].sort((a, b) => a.start - b.start);
  const out: TranscriptEntry[] = [];
  const order: string[] = [];
  const idFor = (raw: string) => {
    let i = order.indexOf(raw);
    if (i === -1) {
      order.push(raw);
      i = order.length - 1;
    }
    return `S${i + 1}`;
  };
  if (!segs.length) return { entries: entries.map((e) => ({ ...e, speaker: "S1" })), speakerIds: ["S1"] };

  for (const e of entries) {
    if (!e.words.length) {
      const sp = overlapSpeaker(segs, e.t_start, e.t_end) ?? speakerAt(segs, (e.t_start + e.t_end) / 2);
      out.push({ ...e, speaker: sp ? idFor(sp) : out[out.length - 1]?.speaker ?? "S1" });
      continue;
    }
    let run: Word[] = [];
    let runSpeaker: string | null = null;
    const flush = () => {
      if (!run.length) return;
      const last = run[run.length - 1]!;
      out.push({
        t_start: run[0]!.t,
        t_end: last.t_end ?? last.t,
        speaker: runSpeaker ? idFor(runSpeaker) : out[out.length - 1]?.speaker ?? "S1",
        text: run.map((w) => w.w).join(" ").replace(/\s+([,.!?;:])/g, "$1"),
        words: run,
      });
      run = [];
    };
    let carried: string | null = null;
    for (const w of e.words) {
      const mid = w.t_end !== undefined ? (w.t + w.t_end) / 2 : w.t;
      const sp: string | null = speakerAt(segs, mid) ?? carried ?? overlapSpeaker(segs, e.t_start, e.t_end);
      carried = sp;
      if (runSpeaker !== null && sp !== runSpeaker) flush();
      runSpeaker = sp;
      run.push(w);
    }
    flush();
    // Keep the original entry end for the last run when the words stop early.
    const lastOut = out[out.length - 1];
    if (lastOut && lastOut.t_end < e.t_end && lastOut.t_end >= e.t_start) lastOut.t_end = e.t_end;
  }
  return { entries: out, speakerIds: order.map((_, i) => `S${i + 1}`) };
}

/** Group consecutive entries by speaker into reading paragraphs (~maxChars each, timecode at each paragraph start). */
export type DialogueParagraph = { speaker: string; t_start: number; t_end: number; text: string };
export function toDialogue(entries: TranscriptEntry[], opts: { maxChars?: number } = {}): DialogueParagraph[] {
  const max = opts.maxChars ?? 700;
  const out: DialogueParagraph[] = [];
  for (const e of entries) {
    const text = e.text.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.speaker === e.speaker && last.text.length + text.length < max) {
      last.text += ` ${text}`;
      last.t_end = e.t_end;
    } else out.push({ speaker: e.speaker, t_start: e.t_start, t_end: e.t_end, text });
  }
  return out;
}
