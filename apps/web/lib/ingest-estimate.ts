import type { JobProgress } from "@marrow/core";

// How far along an ingest is, and roughly how long it takes — so a card in flight never looks stuck.

const TEXT_KINDS = new Set(["captured_post", "newsletter", "paper", "note"]);

/** Typical wall time in seconds: ~2 min fixed (download, article, references) + ~8 s per minute of media. */
export function estimateIngestSeconds(input: { sourceType: string; durationS?: number | null }): number {
  if (TEXT_KINDS.has(input.sourceType)) return 60;
  const duration = input.durationS && input.durationS > 0 ? input.durationS : 20 * 60; // unknown yet (before fetch): assume a 20-min video
  return Math.round(120 + duration * 0.13);
}

export type StepSummary = { done: number; total: number; percent: number; current: JobProgress["steps"][number] | null; failed: JobProgress["steps"][number] | null };

/** Done + skipped count as complete; the denominator drops steps that turned out not to apply. */
export function summarizeSteps(steps: JobProgress["steps"]): StepSummary {
  const applicable = steps.filter((s) => s.state !== "skipped");
  const done = applicable.filter((s) => s.state === "done").length;
  const total = applicable.length;
  const current = steps.find((s) => s.state === "running") ?? null;
  const failed = steps.find((s) => s.state === "failed") ?? null;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0, current, failed };
}

/** "about 6 min left" / "under a minute left" / "taking longer than usual — still working". */
export function remainingLabel(elapsedS: number, estimateS: number): string {
  const left = estimateS - elapsedS;
  if (left <= 0) return "taking longer than usual — still working";
  if (left < 60) return "under a minute left";
  return `about ${Math.ceil(left / 60)} min left`;
}

export const fmtElapsed = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
