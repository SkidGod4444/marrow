import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { audioKey, type TranscriptEntry, type Word } from "../../document.ts";
import { planChunks } from "../../media/ffmpeg.ts";
import type { SttResult } from "../../openai/transcribe.ts";
import type { StageFn } from "../types.ts";
import { ensureLocal, round2 } from "./helpers.ts";

/** Stage 2 — whisper-1 with word timestamps; silence-split when the audio exceeds the 25 MB cap. */
export const transcribeStage: StageFn = async (ctx) => {
  const { doc, item, providers, workDir, config, usage, log } = ctx;
  await mkdir(workDir, { recursive: true });
  const audioPath = await ensureLocal(ctx, audioKey(item.id), join(workDir, "audio.ogg"));
  const size = (await stat(audioPath)).size;

  const chunks: Array<{ path: string; offset: number }> = [];
  if (size <= config.STT_MAX_BYTES) {
    chunks.push({ path: audioPath, offset: 0 });
  } else {
    const { duration } = await providers.probe(audioPath);
    const bytesPerSec = size / Math.max(1, duration);
    const max = Math.floor((config.STT_MAX_BYTES * 0.9) / bytesPerSec);
    const plan = planChunks(duration, await providers.detectSilences(audioPath), { target: max * 0.8, max });
    log(`audio is ${(size / 1e6).toFixed(1)} MB (> cap) — splitting into ${plan.length} chunks at silences`);
    const dir = join(workDir, "chunks");
    await mkdir(dir, { recursive: true });
    for (const [i, c] of plan.entries()) {
      const p = join(dir, `${i}.ogg`);
      await providers.cutAudio(audioPath, c.start, c.end, p);
      chunks.push({ path: p, offset: c.start });
    }
  }

  const entries: TranscriptEntry[] = [];
  let language: string | null = null;
  for (const [i, c] of chunks.entries()) {
    log(`transcribing ${chunks.length > 1 ? `chunk ${i + 1}/${chunks.length}` : "audio"}`);
    const r = await providers.transcribe(c.path, usage);
    language ??= r.language;
    entries.push(...toEntries(r, c.offset));
  }
  doc.language = language;
  doc.transcript = entries;
  if (!doc.speakers.length) doc.speakers = [{ id: "S1", label: "Speaker 1" }];
  log(`${entries.length} transcript entries, ${entries.reduce((n, e) => n + e.words.length, 0)} words`);
};

/** whisper segments → transcript entries, each carrying the words that start inside it (offset for chunking). */
export function toEntries(r: SttResult, offset: number): TranscriptEntry[] {
  const words = [...r.words].sort((a, b) => a.start - b.start);
  let wi = 0;
  const out: TranscriptEntry[] = [];
  for (const seg of r.segments) {
    const text = seg.text.trim();
    if (!text) continue;
    const ws: Word[] = [];
    while (wi < words.length && words[wi]!.start < seg.end - 0.001) {
      const w = words[wi++]!;
      ws.push({ w: w.word.trim(), t: round2(w.start + offset), t_end: round2(w.end + offset) });
    }
    out.push({ t_start: round2(seg.start + offset), t_end: round2(seg.end + offset), speaker: "S1", text, words: ws });
  }
  return out;
}
