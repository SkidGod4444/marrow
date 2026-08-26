import type { StageFn } from "../types.ts";

/** Stage 9 — only for namespaces flagged `language_learning`; implementation lands in Phase 6. */
export const languageStage: StageFn = async (ctx) => {
  if (!ctx.namespace.flags?.language_learning) return { skipped: "namespace is not flagged language_learning" };
  return { skipped: "language pass ships in Phase 6 — re-run with --stages language afterwards" };
};
