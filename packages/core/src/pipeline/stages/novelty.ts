import { and, eq, ne, sql } from "drizzle-orm";
import { items } from "../../db/index.ts";
import type { StageFn } from "../types.ts";

export const NOVELTY_MIN_ITEMS = 5;

/** Stage 10 — novelty triage runs only once a namespace has ≥ 5 other items; implementation lands in Phase 4. */
export const noveltyStage: StageFn = async (ctx) => {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(and(eq(items.namespaceId, ctx.namespace.id), eq(items.status, "ready"), ne(items.id, ctx.item.id)));
  const n = row?.n ?? 0;
  if (n < NOVELTY_MIN_ITEMS) return { skipped: `namespace has ${n} ready items (< ${NOVELTY_MIN_ITEMS})` };
  return { skipped: "novelty triage ships in Phase 4 — re-run with --stages novelty afterwards" };
};
