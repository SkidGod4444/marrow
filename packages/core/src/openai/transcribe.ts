import { createReadStream } from "node:fs";
import type { Config } from "../config.ts";
import { getOpenAI, type UsageTracker } from "./client.ts";

export type SttWord = { word: string; start: number; end: number };
export type SttSegment = { start: number; end: number; text: string };
export type SttResult = { language: string | null; duration: number; text: string; segments: SttSegment[]; words: SttWord[] };

/**
 * STACK:stt — OpenAI `whisper-1` is the only hosted OpenAI model returning word-level timestamps
 * (`timestamp_granularities: ["word"]`), which PRD §4.3 makes mandatory. 25 MB file cap; callers chunk above it.
 */
export async function transcribeFile(cfg: Config, path: string, usage: UsageTracker): Promise<SttResult> {
  const openai = getOpenAI(cfg);
  const res = await openai.audio.transcriptions.create({
    file: createReadStream(path),
    model: cfg.STT_MODEL,
    response_format: "verbose_json",
    timestamp_granularities: ["word", "segment"],
  });
  const duration = Number(res.duration ?? 0);
  usage.add(cfg.STT_MODEL, { audio_seconds: duration, requests: 1 });
  return {
    language: res.language ?? null,
    duration,
    text: res.text,
    segments: (res.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text })),
    words: (res.words ?? []).map((w) => ({ word: w.word, start: w.start, end: w.end })),
  };
}
