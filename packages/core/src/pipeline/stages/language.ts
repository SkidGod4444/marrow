import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type TranscriptEntry, audioKey, clipKey } from "../../document.ts";
import { isTextSource } from "../../ids.ts";
import { transcriptContext } from "../context.ts";
import { LANGUAGE_SYSTEM, LanguageLLMSchema } from "../prompts.ts";
import type { StageFn } from "../types.ts";
import { ensureLocal, round2 } from "./helpers.ts";

// Stage 9 — PRD §6.3 language mode: expressions worth learning, each with the exact spoken span (from word
// timestamps) and a playable audio clip of just that span (`clips/{item}/{n}.m4a`). Namespaces flagged
// `language_learning` only; media items only.

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, " ").trim();

export type Span = { t_start: number; t_end: number; exact: boolean };

/** Locate an expression inside the transcript near `t`: exact word-run match first, else the closest line's span. */
export function locateSpan(transcript: TranscriptEntry[], text: string, t: number): Span | null {
  if (!transcript.length) return null;
  const want = norm(text).split(" ").filter(Boolean);
  const near = transcript.map((e, i) => ({ e, i, d: Math.abs(e.t_start - t) })).sort((a, b) => a.d - b.d).slice(0, 6);
  if (want.length) {
    for (const { e } of near) {
      const words = e.words.map((w) => ({ ...w, k: norm(w.w) })).filter((w) => w.k);
      for (let i = 0; i + want.length <= words.length; i++) {
        let ok = true;
        for (let j = 0; j < want.length; j++) {
          if (words[i + j]!.k !== want[j]) {
            ok = false;
            break;
          }
        }
        if (ok) {
          const first = words[i]!;
          const last = words[i + want.length - 1]!;
          return { t_start: round2(first.t), t_end: round2(last.t_end ?? last.t + 0.4), exact: true };
        }
      }
    }
  }
  // Fallback: the line itself (still a short, playable span).
  const line = near.find(({ e }) => norm(e.text).includes(want.join(" ")))?.e ?? near[0]!.e;
  return { t_start: round2(line.t_start), t_end: round2(line.t_end), exact: false };
}

export const languageStage: StageFn = async (ctx) => {
  const { doc, item, namespace, providers, storage, workDir, usage, log } = ctx;
  if (!namespace.flags?.language_learning) return { skipped: "namespace is not flagged language_learning" };
  if (isTextSource(doc.source_type)) return { skipped: "text source" };
  if (!doc.transcript.length) return { skipped: "no transcript" };

  const out = await providers.generate({ system: LANGUAGE_SYSTEM, user: transcriptContext(doc), schema: LanguageLLMSchema, schemaName: "language_pack", effort: "low", verbosity: "medium" }, usage);
  const seen = new Set<string>();
  const picked = out.expressions.filter((x) => {
    const k = norm(x.text);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  log(`${picked.length} expressions from the model`);

  await mkdir(workDir, { recursive: true });
  const audioPath = await ensureLocal(ctx, audioKey(item.id), join(workDir, "audio.ogg"));
  const expressions: NonNullable<typeof doc.language_pack>["expressions"] = [];
  let exact = 0;
  for (const x of picked) {
    const span = locateSpan(doc.transcript, x.text, x.t);
    if (!span) continue;
    if (span.exact) exact++;
    const n = expressions.length;
    const key = clipKey(item.id, n);
    const local = join(workDir, `clip-${n}.m4a`);
    try {
      await providers.cutClip(audioPath, span.t_start, span.t_end, local);
      await storage.putFile(key, local, "audio/mp4");
      expressions.push({ text: x.text, kind: x.kind, explanation: x.explanation, t_start: span.t_start, t_end: span.t_end, clip_s3_key: key });
    } catch (err) {
      log(`clip ${n} failed (${(err as Error).message}) — keeping the expression without audio`);
      expressions.push({ text: x.text, kind: x.kind, explanation: x.explanation, t_start: span.t_start, t_end: span.t_end });
    }
  }
  doc.language_pack = { expressions };
  log(`language pack: ${expressions.length} expressions, ${exact} exact word spans, ${expressions.filter((e) => e.clip_s3_key).length} clips`);
};
