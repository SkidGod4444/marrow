import type { StageFn } from "../types.ts";

/** Stage 3 — STACK:diarization is deferred (see docs/STACK.md); apply the `speakers: [S1]` fallback the PRD allows. */
export const diarizeStage: StageFn = async (ctx) => {
  ctx.doc.speakers = [{ id: "S1", label: "Speaker 1" }];
  for (const e of ctx.doc.transcript) e.speaker = "S1";
  return { skipped: "diarization deferred (STACK:diarization) — single-speaker fallback applied" };
};
