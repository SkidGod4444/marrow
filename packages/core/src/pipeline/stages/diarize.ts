import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../../config.ts";
import type { Namespace } from "../../db/index.ts";
import { audioKey, type VideoDocument } from "../../document.ts";
import { planChunks } from "../../media/ffmpeg.ts";
import type { DiarSegment, KnownSpeaker } from "../../openai/diarize.ts";
import { SPEAKER_LABELS_SYSTEM, SpeakerLabelsSchema } from "../prompts.ts";
import { alignSpeakers } from "../speakers.ts";
import { isTextSource } from "../../ids.ts";
import type { StageFn } from "../types.ts";
import { ensureLocal } from "./helpers.ts";

const MULTI_SPEAKER = /\b(podcast|interview|episode|ep\.?\s?\d|conversation|panel|fireside|q\s?&\s?a|roundtable|debate|discussion|talks? with|in conversation|feat\.|ft\.)\b/i;

/** PRD §5 stage 3: diarize only when metadata/heuristics (or the namespace flag) suggest more than one speaker. */
export function shouldDiarize(doc: VideoDocument, namespace: Namespace, config: Config): { yes: boolean; reason: string } {
  if (config.DIARIZE === "off") return { yes: false, reason: "DIARIZE=off" };
  if (config.DIARIZE === "always") return { yes: true, reason: "DIARIZE=always" };
  if (namespace.flags?.diarize === true) return { yes: true, reason: "namespace flag diarize=true" };
  if (namespace.flags?.diarize === false) return { yes: false, reason: "namespace flag diarize=false" };
  if (doc.source_type === "podcast_episode") return { yes: true, reason: "podcast episode" };
  const haystack = `${doc.title} ${doc.channel} ${doc.description.slice(0, 600)}`;
  const m = MULTI_SPEAKER.exec(haystack);
  if (m) return { yes: true, reason: `looks multi-speaker ("${m[0]}")` };
  return { yes: false, reason: "no multi-speaker signal in metadata" };
}

/** A 2–10 s reference clip per speaker from the first piece, so later pieces reuse the same labels. */
async function referenceClips(ctx: Parameters<StageFn>[0], audioPath: string, segs: DiarSegment[], offset: number): Promise<KnownSpeaker[]> {
  const bySpeaker = new Map<string, DiarSegment>();
  for (const s of segs) {
    const cur = bySpeaker.get(s.speaker);
    if (!cur || s.end - s.start > cur.end - cur.start) bySpeaker.set(s.speaker, s);
  }
  const dir = join(ctx.workDir, "speakers");
  await mkdir(dir, { recursive: true });
  const out: KnownSpeaker[] = [];
  for (const [speaker, s] of [...bySpeaker.entries()].slice(0, 4)) {
    const len = Math.min(8, s.end - s.start);
    if (len < 2.2) continue;
    const p = join(dir, `${speaker}.ogg`);
    await ctx.providers.cutAudio(audioPath, s.start - offset, s.start - offset + len, p);
    out.push({ name: speaker, dataUrl: `data:audio/ogg;base64,${(await readFile(p)).toString("base64")}` });
  }
  return out;
}

export const diarizeStage: StageFn = async (ctx) => {
  const { doc, item, namespace, config, providers, usage, log, workDir } = ctx;
  if (isTextSource(doc.source_type)) return { skipped: "text source" };
  const decision = shouldDiarize(doc, namespace, config);
  if (!decision.yes || !doc.transcript.length) {
    doc.speakers = [{ id: "S1", label: "Speaker 1" }];
    for (const e of doc.transcript) e.speaker = "S1";
    return { skipped: `single-speaker fallback (${decision.yes ? "no transcript" : decision.reason})` };
  }
  log(`diarizing — ${decision.reason}`);
  await mkdir(workDir, { recursive: true });
  const audioPath = await ensureLocal(ctx, audioKey(item.id), join(workDir, "audio.ogg"));
  const duration = doc.duration_s || (await providers.probe(audioPath)).duration;

  // gpt-4o-transcribe-diarize caps output at 2k tokens per request → ~7-minute pieces cut at silences.
  const pieces = duration > config.DIARIZE_CHUNK_S ? planChunks(duration, await providers.detectSilences(audioPath), { target: config.DIARIZE_CHUNK_S, max: config.DIARIZE_CHUNK_S * 1.15 }) : [{ start: 0, end: duration }];
  const dir = join(workDir, "diar");
  await mkdir(dir, { recursive: true });
  const all: DiarSegment[] = [];
  let known: KnownSpeaker[] = [];
  for (const [i, p] of pieces.entries()) {
    let path = audioPath;
    if (pieces.length > 1) {
      path = join(dir, `${i}.ogg`);
      await providers.cutAudio(audioPath, p.start, p.end, path);
    }
    const segs = await providers.diarize(path, { known, language: doc.language }, usage);
    const shifted = segs.map((s) => ({ ...s, start: s.start + p.start, end: s.end + p.start }));
    all.push(...shifted);
    if (i === 0 && pieces.length > 1) {
      known = await referenceClips(ctx, path, segs, 0);
      log(`piece 1/${pieces.length}: ${new Set(segs.map((s) => s.speaker)).size} speakers, ${known.length} reference clips`);
    } else if (pieces.length > 1) log(`piece ${i + 1}/${pieces.length} diarized`);
  }

  const aligned = alignSpeakers(doc.transcript, all);
  doc.transcript = aligned.entries;
  const ids = aligned.speakerIds.length ? aligned.speakerIds : ["S1"];

  // Name the speakers from a sample of tagged lines (cheap LLM).
  const sample = doc.transcript.slice(0, 80).map((e) => `${e.speaker}: ${e.text}`).join("\n").slice(0, 6000);
  let labels = new Map<string, string>();
  if (ids.length > 1) {
    try {
      const r = await providers.generate(
        { system: SPEAKER_LABELS_SYSTEM, user: JSON.stringify({ title: doc.title, channel: doc.channel, description: doc.description.slice(0, 800), speakers: ids, sample }), schema: SpeakerLabelsSchema, schemaName: "speaker_labels", effort: "none", verbosity: "low" },
        usage,
      );
      labels = new Map(r.speakers.map((s) => [s.id, s.label]));
    } catch (err) {
      log(`speaker labelling failed: ${(err as Error).message}`);
    }
  }
  doc.speakers = ids.map((id, i) => ({ id, label: labels.get(id) || `Speaker ${i + 1}` }));
  log(`${ids.length} speaker${ids.length === 1 ? "" : "s"}: ${doc.speakers.map((s) => `${s.id}=${s.label}`).join(", ")}; ${doc.transcript.length} entries after alignment`);
};
