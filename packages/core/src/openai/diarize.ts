import { createReadStream } from "node:fs";
import type OpenAI from "openai";
import type { Config } from "../config.ts";
import { getOpenAI, type UsageTracker } from "./client.ts";

export type DiarSegment = { start: number; end: number; speaker: string; text: string };
export type KnownSpeaker = { name: string; dataUrl: string };

/**
 * STACK:diarization — OpenAI `gpt-4o-transcribe-diarize` (`diarized_json`). It labels speakers but has no word
 * timestamps and a 2,000-token output cap per request, so callers send ≤ ~7-minute pieces and align the result onto
 * the whisper word-level transcript (pipeline/speakers.ts). `known` carries 2–10 s reference clips so speaker
 * labels stay consistent across pieces (max 4 speakers).
 */
export async function diarizeFile(cfg: Config, path: string, opts: { known?: KnownSpeaker[]; language?: string | null }, usage: UsageTracker): Promise<DiarSegment[]> {
  const openai = getOpenAI(cfg);
  const known = (opts.known ?? []).slice(0, 4);
  const res = (await openai.audio.transcriptions.create({
    file: createReadStream(path),
    model: cfg.DIARIZE_MODEL,
    response_format: "diarized_json",
    chunking_strategy: "auto",
    ...(known.length ? { known_speaker_names: known.map((k) => k.name), known_speaker_references: known.map((k) => k.dataUrl) } : {}),
    ...(opts.language ? { language: opts.language } : {}),
  })) as OpenAI.Audio.Transcriptions.TranscriptionDiarized;
  const duration = Number(res.duration ?? 0) || (res.segments?.length ? res.segments[res.segments.length - 1]!.end : 0);
  usage.add(cfg.DIARIZE_MODEL, { audio_seconds: duration, requests: 1 });
  return (res.segments ?? []).map((s) => ({ start: s.start, end: s.end, speaker: s.speaker, text: s.text }));
}
