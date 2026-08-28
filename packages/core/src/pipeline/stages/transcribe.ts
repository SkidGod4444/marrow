import { mkdir, stat } from "node:fs/promises";
import { pMap } from "../../util.ts";
import { join } from "node:path";
import { audioKey, type TranscriptEntry, type Word } from "../../document.ts";
import { isTextSource } from "../../ids.ts";
import { planChunks } from "../../media/ffmpeg.ts";
import type { SttResult } from "../../openai/transcribe.ts";
import type { StageFn } from "../types.ts";
import { ensureLocal, round2 } from "./helpers.ts";

/** Stage 2 — whisper-1 with word timestamps; silence-split when the audio exceeds the 25 MB cap. */
/**
 * How long a chunk may be: the smaller of what fits the byte cap (with headroom) and the duration cap — or null when the
 * whole file fits both. The target sits at 80% of the max so the silence search has room on either side.
 */
export function chunkLimits(input: { size: number; duration: number; maxBytes: number; maxSeconds: number }): { target: number; max: number } | null {
  const byBytes = input.size > input.maxBytes ? Math.floor((input.maxBytes * 0.9) / (input.size / Math.max(1, input.duration))) : Number.POSITIVE_INFINITY;
  const max = Math.min(byBytes, input.maxSeconds);
  if (input.size <= input.maxBytes && input.duration <= input.maxSeconds) return null;
  return { target: Math.floor(max * 0.8), max };
}

export const transcribeStage: StageFn = async (ctx) => {
  const { doc, item, providers, workDir, config, usage, log } = ctx;
  if (isTextSource(doc.source_type)) return { skipped: "text source" };
  await mkdir(workDir, { recursive: true });
  const audioPath = await ensureLocal(ctx, audioKey(item.id), join(workDir, "audio.ogg"));
  const size = (await stat(audioPath)).size;

  const chunks: Array<{ path: string; offset: number }> = [];
  const { duration } = await providers.probe(audioPath);
  const limits = chunkLimits({ size, duration, maxBytes: config.STT_MAX_BYTES, maxSeconds: config.STT_CHUNK_MAX_S });
  if (!limits) {
    chunks.push({ path: audioPath, offset: 0 });
  } else {
    const plan = planChunks(duration, await providers.detectSilences(audioPath), limits);
    log(`audio is ${(size / 1e6).toFixed(1)} MB / ${Math.round(duration / 60)} min — splitting into ${plan.length} chunks at silences (≤ ${Math.round(limits.max / 60)} min each)`);
    const dir = join(workDir, "chunks");
    await mkdir(dir, { recursive: true });
    for (const [i, c] of plan.entries()) {
      const p = join(dir, `${i}.ogg`);
      await providers.cutAudio(audioPath, c.start, c.end, p);
      chunks.push({ path: p, offset: c.start });
    }
  }

  // Chunks go to the STT API in parallel (it is the long pole of the whole pipeline); results are stitched in order.
  const results: SttResult[] = Array.from({ length: chunks.length });
  await pMap(
    chunks,
    async (c, i) => {
      log(`transcribing ${chunks.length > 1 ? `chunk ${i + 1}/${chunks.length}` : "audio"}`);
      results[i] = await providers.transcribe(c.path, usage);
    },
    config.STT_CONCURRENCY,
  );
  const entries: TranscriptEntry[] = [];
  let language: string | null = null;
  for (const [i, c] of chunks.entries()) {
    const r = results[i]!;
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
