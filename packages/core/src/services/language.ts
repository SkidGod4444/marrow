import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { type Db, type ExpressionReview, expressionReviews, items } from "../db/index.ts";
import type { VideoDocument } from "../document.ts";
import { newId } from "../ids.ts";
import type { Storage } from "../storage/index.ts";
import { deepLink } from "../timefmt.ts";
import { getDocument } from "./documents.ts";
import { logEvent } from "./events.ts";

// PRD §6.3: per-episode expression list (expression, explanation, exact clip, jump link) and a simple review queue —
// expressions the owner marks "learn" come back as recall prompts after 2 days, then 7, then 30.

export const REVIEW_INTERVALS_DAYS = [2, 7, 30] as const;
const DAY = 24 * 60 * 60 * 1000;

export function nextDue(stage: number, from = new Date()): Date {
  const days = REVIEW_INTERVALS_DAYS[Math.min(stage, REVIEW_INTERVALS_DAYS.length - 1)]!;
  return new Date(from.getTime() + days * DAY);
}

export type ExpressionView = {
  n: number;
  text: string;
  kind: string;
  explanation: string;
  context: string | null;
  t_start: number;
  t_end: number;
  /** Relative API path of the clip (null when the clip could not be cut). */
  clip_url: string | null;
  deep_link: string;
  saved: boolean;
  review_id: string | null;
  due_at: string | null;
};

/** The item's language pack with save state merged in. */
export async function listExpressions(deps: { db: Db; storage: Storage }, itemId: string, userId?: string | null): Promise<{ item_id: string; title: string; expressions: ExpressionView[] } | null> {
  const [item] = await deps.db.select().from(items).where(eq(items.id, itemId));
  if (!item) return null;
  const doc = await getDocument(deps.storage, itemId);
  if (!doc) return null;
  const saved = await deps.db.select().from(expressionReviews).where(and(eq(expressionReviews.itemId, itemId), userScope(userId)));
  const byN = new Map(saved.map((r) => [r.n, r]));
  return { item_id: itemId, title: doc.title, expressions: presentExpressions(doc, byN) };
}

export function presentExpressions(doc: VideoDocument, saved: Map<number, ExpressionReview> = new Map()): ExpressionView[] {
  return (doc.language_pack?.expressions ?? []).map((e, n) => ({
    n,
    text: e.text,
    kind: e.kind,
    explanation: e.explanation,
    context: e.context ?? null,
    t_start: e.t_start,
    t_end: e.t_end,
    clip_url: e.clip_s3_key ? `/items/${doc.id}/clips/${n}` : null,
    deep_link: deepLink(doc.source_url, e.t_start),
    saved: saved.has(n),
    review_id: saved.get(n)?.id ?? null,
    due_at: saved.get(n)?.dueAt.toISOString() ?? null,
  }));
}

/** Rows of one learner (null = rows from before multi-tenancy, visible to everyone in tests/CLI). */
const userScope = (userId?: string | null) => (userId ? eq(expressionReviews.userId, userId) : isNull(expressionReviews.userId));

/** "Learn": put the expression in the learner's review queue (first recall prompt in 2 days). Idempotent. */
export async function saveExpression(deps: { db: Db; storage: Storage }, itemId: string, n: number, userId?: string | null): Promise<ExpressionReview> {
  const doc = await getDocument(deps.storage, itemId);
  const e = doc?.language_pack?.expressions[n];
  if (!doc || !e) throw new Error("expression not found");
  const [existing] = await deps.db.select().from(expressionReviews).where(and(eq(expressionReviews.itemId, itemId), eq(expressionReviews.n, n), userScope(userId)));
  if (existing) return existing;
  const [row] = await deps.db
    .insert(expressionReviews)
    .values({ id: newId("rev"), itemId, userId: userId ?? null, n, text: e.text, kind: e.kind, explanation: e.explanation, context: e.context ?? null, tStart: e.t_start, tEnd: e.t_end, clipKey: e.clip_s3_key ?? null, stage: 0, dueAt: nextDue(0) })
    .returning();
  await logEvent(deps.db, itemId, "expression_saved", userId);
  return row!;
}

export async function unsaveExpression(db: Db, itemId: string, n: number, userId?: string | null): Promise<boolean> {
  const rows = await db.delete(expressionReviews).where(and(eq(expressionReviews.itemId, itemId), eq(expressionReviews.n, n), userScope(userId))).returning({ id: expressionReviews.id });
  return rows.length > 0;
}

export type ReviewCard = ExpressionReview & { item_title: string; source_url: string; clip_url: string | null; deep_link: string };

function toCard(r: ExpressionReview, item: { title: string; sourceUrl: string }): ReviewCard {
  return { ...r, item_title: item.title, source_url: item.sourceUrl, clip_url: r.clipKey ? `/items/${r.itemId}/clips/${r.n}` : null, deep_link: deepLink(item.sourceUrl, r.tStart) };
}

/** Cards due now (oldest first), plus what's coming. */
export async function reviewQueue(db: Db, opts: { userId?: string | null; now?: Date; limit?: number } = {}): Promise<{ due: ReviewCard[]; upcoming: ReviewCard[]; total: number }> {
  const now = opts.now ?? new Date();
  const rows = await db
    .select({ review: expressionReviews, title: items.title, sourceUrl: items.sourceUrl })
    .from(expressionReviews)
    .innerJoin(items, eq(items.id, expressionReviews.itemId))
    .where(userScope(opts.userId))
    .orderBy(asc(expressionReviews.dueAt));
  const cards = rows.map((r) => toCard(r.review, { title: r.title, sourceUrl: r.sourceUrl }));
  const due = cards.filter((c) => c.dueAt <= now).slice(0, opts.limit ?? 50);
  const upcoming = cards.filter((c) => c.dueAt > now).slice(0, 10);
  return { due, upcoming, total: cards.length };
}

export async function reviewSummary(db: Db, now = new Date(), userId?: string | null): Promise<{ due: number; total: number; next_due_at: string | null }> {
  const rows = await db.select({ dueAt: expressionReviews.dueAt }).from(expressionReviews).where(userScope(userId)).orderBy(asc(expressionReviews.dueAt));
  const due = rows.filter((r) => r.dueAt <= now).length;
  const next = rows.find((r) => r.dueAt > now)?.dueAt ?? null;
  return { due, total: rows.length, next_due_at: next ? next.toISOString() : null };
}

/** Answer a recall prompt: "got it" advances 2d → 7d → 30d (then every 30d); "again" starts over at 2d. */
export async function answerReview(db: Db, id: string, result: "got_it" | "again", now = new Date(), userId?: string | null): Promise<ExpressionReview | null> {
  const [r] = await db.select().from(expressionReviews).where(eq(expressionReviews.id, id));
  if (!r) return null;
  if (userId && r.userId && r.userId !== userId) return null; // someone else's card
  const stage = result === "got_it" ? r.stage + 1 : 0;
  const [row] = await db
    .update(expressionReviews)
    .set({ stage, dueAt: nextDue(stage, now), reviews: r.reviews + 1, lastResult: result, updatedAt: now })
    .where(eq(expressionReviews.id, id))
    .returning();
  return row ?? null;
}

/** Everything due — used by the MCP tool so an agent can quiz the owner. */
export async function dueReviews(db: Db, now = new Date(), userId?: string | null): Promise<ReviewCard[]> {
  return (await reviewQueue(db, { now, userId })).due;
}

export function isDue(r: { dueAt: Date }, now = new Date()): boolean {
  return r.dueAt <= now;
}

/** Guard for list queries: `lte` re-exported to keep drizzle out of route files. */
export const dueBefore = (now: Date) => lte(expressionReviews.dueAt, now);
