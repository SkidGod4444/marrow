import { and, between, eq } from "drizzle-orm";
import { type Db, items, segments } from "../db/index.ts";
import { deepLink, fmtTs, transcriptLines } from "../timefmt.ts";
import type { Storage } from "../storage/index.ts";
import { getDocument } from "./documents.ts";

export type SegmentContext = {
  segment_id: string;
  item_id: string;
  title: string;
  source_url: string;
  t_start: number | null;
  t_end: number | null;
  deep_link: string;
  /** "[MM:SS] text" lines covering the window (timed sources) or neighbouring segments (text sources). */
  context: string;
};

/** PRD §8 `get_context(segment_id, window_s=120)`: surrounding transcript text. */
export async function getContext(deps: { db: Db; storage: Storage }, segmentId: string, windowS = 120): Promise<SegmentContext | null> {
  const [row] = await deps.db.select({ seg: segments, item: items }).from(segments).innerJoin(items, eq(items.id, segments.itemId)).where(eq(segments.id, segmentId));
  if (!row) return null;
  const { seg, item } = row;
  const base = { segment_id: seg.id, item_id: item.id, title: item.title, source_url: item.sourceUrl, t_start: seg.tStart, t_end: seg.tEnd, deep_link: deepLink(item.sourceUrl, seg.tStart) };

  if (seg.tStart === null || seg.tEnd === null) {
    const neighbours = await deps.db
      .select()
      .from(segments)
      .where(and(eq(segments.itemId, item.id), between(segments.position, seg.position - 2, seg.position + 2)))
      .orderBy(segments.position);
    return { ...base, context: neighbours.map((s) => (s.id === seg.id ? `>>> ${s.text}` : s.text)).join("\n\n") };
  }

  const doc = await getDocument(deps.storage, item.id);
  const lo = Math.max(0, seg.tStart - windowS);
  const hi = seg.tEnd + windowS;
  const entries = (doc?.transcript ?? []).filter((e) => e.t_end >= lo && e.t_start <= hi);
  const context = entries.length
    ? transcriptLines(entries)
    : `[${fmtTs(seg.tStart)}] ${seg.text}`;
  return { ...base, t_start: lo, t_end: hi, context };
}
