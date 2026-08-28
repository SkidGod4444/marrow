import { and, cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Config } from "../config.ts";
import { type Db, frames, items, segments } from "../db/index.ts";
import { deepLink } from "../timefmt.ts";
import { getNamespace } from "./namespaces.ts";

export type SearchHit = {
  segment_id: string;
  item_id: string;
  title: string;
  channel: string;
  source_type: string;
  source_url: string;
  t_start: number | null;
  t_end: number | null;
  deep_link: string;
  text: string;
  frame_captions: string[];
  score: number;
  vector_rank: number | null;
  fts_rank: number | null;
};

export type SearchInput = { namespace: string; organizationId?: string; query: string; k?: number; sourceType?: string };

export type SearchDeps = {
  db: Db;
  config: Config;
  embedQuery: (text: string) => Promise<number[]>;
  /** Optional cheap-LLM reranker (SEARCH_RERANK=llm). Returns candidate ids in preferred order. */
  rerank?: (query: string, candidates: Array<{ id: string; text: string }>) => Promise<string[]>;
};

const RRF_K = 60;

/**
 * PRD §8 `search`: hybrid retrieval — vector (cosine) + BM25-style FTS (`websearch_to_tsquery` + `ts_rank_cd`) — merged
 * with reciprocal rank fusion, over-fetching SEARCH_OVERFETCH×k candidates from each leg, reranked to k. Every hit
 * carries a timestamp + deep link; `sourceType` filters e.g. to `note` or `youtube_video`.
 */
export async function search(deps: SearchDeps, input: SearchInput): Promise<{ namespace: { id: string; name: string }; hits: SearchHit[] }> {
  const { db, config } = deps;
  const ns = await getNamespace(db, input.namespace, input.organizationId);
  if (!ns) throw new Error(`namespace "${input.namespace}" not found`);
  const k = Math.max(1, Math.min(input.k ?? 8, 50));
  const n = k * config.SEARCH_OVERFETCH;
  const query = input.query.trim();
  if (!query) return { namespace: { id: ns.id, name: ns.name }, hits: [] };

  const scope = input.sourceType ? and(eq(segments.namespaceId, ns.id), eq(segments.sourceType, input.sourceType)) : eq(segments.namespaceId, ns.id);

  const [vecRows, ftsRows] = await Promise.all([
    deps.embedQuery(query).then((vec) =>
      db
        .select({ id: segments.id, dist: cosineDistance(segments.embedding, vec) })
        .from(segments)
        .where(and(scope, sql`${segments.embedding} IS NOT NULL`))
        .orderBy(cosineDistance(segments.embedding, vec))
        .limit(n),
    ),
    db
      .select({ id: segments.id, rank: sql<number>`ts_rank_cd(${segments.tsv}, websearch_to_tsquery('english', ${query}))` })
      .from(segments)
      .where(and(scope, sql`${segments.tsv} @@ websearch_to_tsquery('english', ${query})`))
      .orderBy(desc(sql`ts_rank_cd(${segments.tsv}, websearch_to_tsquery('english', ${query}))`))
      .limit(n),
  ]);

  const fused = new Map<string, { score: number; vector_rank: number | null; fts_rank: number | null }>();
  vecRows.forEach((r, i) => fused.set(r.id, { score: 1 / (RRF_K + i + 1), vector_rank: i + 1, fts_rank: null }));
  ftsRows.forEach((r, i) => {
    const cur = fused.get(r.id);
    if (cur) {
      cur.score += 1 / (RRF_K + i + 1);
      cur.fts_rank = i + 1;
    } else fused.set(r.id, { score: 1 / (RRF_K + i + 1), vector_rank: null, fts_rank: i + 1 });
  });
  let ordered = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).map(([id]) => id);
  if (ordered.length === 0) return { namespace: { id: ns.id, name: ns.name }, hits: [] };

  const rows = await db
    .select({ seg: segments, item: items })
    .from(segments)
    .innerJoin(items, eq(items.id, segments.itemId))
    .where(inArray(segments.id, ordered.slice(0, Math.max(n, k))));
  const byId = new Map(rows.map((r) => [r.seg.id, r]));

  if (config.SEARCH_RERANK === "llm" && deps.rerank && ordered.length > k) {
    const cands = ordered.slice(0, n).flatMap((id) => (byId.has(id) ? [{ id, text: byId.get(id)!.seg.text.slice(0, 600) }] : []));
    const reranked = await deps.rerank(query, cands);
    const seen = new Set(reranked);
    ordered = [...reranked.filter((id) => byId.has(id)), ...ordered.filter((id) => !seen.has(id))];
  }
  const top = ordered.filter((id) => byId.has(id)).slice(0, k);

  const frameIds = [...new Set(top.flatMap((id) => byId.get(id)!.seg.frameIds))];
  const frameRows = frameIds.length ? await db.select().from(frames).where(inArray(frames.id, frameIds)) : [];
  const captionOf = new Map(frameRows.map((f) => [f.id, f.caption]));

  const hits: SearchHit[] = top.map((id) => {
    const { seg, item } = byId.get(id)!;
    const f = fused.get(id)!;
    return {
      segment_id: seg.id,
      item_id: item.id,
      title: item.title,
      channel: item.channel,
      source_type: seg.sourceType,
      source_url: item.sourceUrl,
      t_start: seg.tStart,
      t_end: seg.tEnd,
      deep_link: deepLink(item.sourceUrl, seg.tStart),
      text: seg.text,
      frame_captions: seg.frameIds.map((fid) => captionOf.get(fid)).filter((c): c is string => Boolean(c)),
      score: Math.round(f.score * 1e6) / 1e6,
      vector_rank: f.vector_rank,
      fts_rank: f.fts_rank,
    };
  });
  return { namespace: { id: ns.id, name: ns.name }, hits };
}

export const RerankSchema = z.object({ ordered_ids: z.array(z.string()) });
export const RERANK_SYSTEM = `You rerank retrieved passages for a research question. Return every candidate id, best first, judging how directly each passage answers or supports the query. Exact matches of paper/tool/repo names count strongly.`;

/** Nearest segments to a query vector inside a namespace, optionally excluding one item (used by novelty triage). */
export async function nearestSegments(
  db: Db,
  namespaceId: string,
  vector: number[],
  opts: { excludeItemId?: string; k?: number } = {},
): Promise<Array<{ segment_id: string; item_id: string; title: string; t_start: number | null; text: string; distance: number }>> {
  const k = opts.k ?? 5;
  const scope = opts.excludeItemId ? and(eq(segments.namespaceId, namespaceId), sql`${segments.itemId} <> ${opts.excludeItemId}`) : eq(segments.namespaceId, namespaceId);
  const rows = await db
    .select({ id: segments.id, itemId: segments.itemId, title: items.title, tStart: segments.tStart, text: segments.text, dist: cosineDistance(segments.embedding, vector) })
    .from(segments)
    .innerJoin(items, eq(items.id, segments.itemId))
    .where(and(scope, sql`${segments.embedding} IS NOT NULL`, eq(items.status, "ready")))
    .orderBy(cosineDistance(segments.embedding, vector))
    .limit(k);
  return rows.map((r) => ({ segment_id: r.id, item_id: r.itemId, title: r.title, t_start: r.tStart, text: r.text, distance: Number(r.dist) }));
}
