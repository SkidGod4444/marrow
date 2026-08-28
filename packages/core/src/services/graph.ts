import { and, eq, inArray, isNotNull, min, sql } from "drizzle-orm";
import { type Db, entities, items, mentions } from "../db/index.ts";
import { getNamespace } from "./namespaces.ts";

// The knowledge graph is a projection of the relational entity index (PRD §9): item ⟷ entity edges built from
// `mentions`, weighted by mention count and carrying the stance mix. Postgres stays the store; this is the view.

export type Stances = { supports: number; opposes: number; neutral: number };

export type GraphNode =
  | { id: string; type: "item"; label: string; channel: string; source_type: string; source_url: string; duration_s: number | null; published_at: string | null; degree: number }
  | { id: string; type: "entity"; label: string; kind: string; url: string | null; aliases: string[]; degree: number; mentions: number; stances: Stances; contested: boolean };

export type GraphClaim = { text: string; stance: "supports" | "opposes" | "neutral" | null; t: number | null };

export type GraphEdge = {
  id: string;
  source: string; // entity id
  target: string; // item id
  weight: number;
  stances: Stances;
  t_first: number | null;
  /** Up to three claims behind this edge (PRD §9): what the item actually says about the entity. */
  claims: GraphClaim[];
};

export type NamespaceGraph = {
  namespace: { id: string; name: string };
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { items: number; entities: number; mentions: number; edges: number; contested: number; truncated_entities: number };
};

/** PRD §8 `get_graph` / `GET /namespaces/:ref/graph`. Keeps the `maxEntities` most-mentioned entities. */
export async function getNamespaceGraph(db: Db, ref: string, opts: { maxEntities?: number; organizationId?: string } = {}): Promise<NamespaceGraph> {
  const ns = await getNamespace(db, ref, opts.organizationId);
  if (!ns) throw new Error(`namespace "${ref}" not found`);
  const maxEntities = Math.max(1, Math.min(opts.maxEntities ?? 150, 1000));

  const readyItems = await db.select().from(items).where(and(eq(items.namespaceId, ns.id), eq(items.status, "ready")));
  const rows = await db
    .select({
      entityId: mentions.entityId,
      itemId: mentions.itemId,
      weight: sql<number>`count(*)::int`,
      supports: sql<number>`sum(case when ${mentions.stance} = 'supports' then 1 else 0 end)::int`,
      opposes: sql<number>`sum(case when ${mentions.stance} = 'opposes' then 1 else 0 end)::int`,
      neutral: sql<number>`sum(case when ${mentions.stance} = 'neutral' then 1 else 0 end)::int`,
      tFirst: min(mentions.t),
    })
    .from(mentions)
    .innerJoin(entities, eq(entities.id, mentions.entityId))
    .innerJoin(items, eq(items.id, mentions.itemId))
    .where(and(eq(entities.namespaceId, ns.id), eq(items.status, "ready")))
    .groupBy(mentions.entityId, mentions.itemId);

  const entityRows = await db.select().from(entities).where(eq(entities.namespaceId, ns.id));
  const perEntity = new Map<string, { mentions: number; items: Set<string>; stances: Stances }>();
  for (const r of rows) {
    const cur = perEntity.get(r.entityId) ?? { mentions: 0, items: new Set<string>(), stances: { supports: 0, opposes: 0, neutral: 0 } };
    cur.mentions += Number(r.weight);
    cur.items.add(r.itemId);
    cur.stances.supports += Number(r.supports);
    cur.stances.opposes += Number(r.opposes);
    cur.stances.neutral += Number(r.neutral);
    perEntity.set(r.entityId, cur);
  }
  const ranked = entityRows
    .filter((e) => perEntity.has(e.id))
    .sort((a, b) => (perEntity.get(b.id)!.mentions - perEntity.get(a.id)!.mentions) || a.name.localeCompare(b.name));
  const kept = ranked.slice(0, maxEntities);
  const keptIds = new Set(kept.map((e) => e.id));

  // The claims behind each edge (a few per pair, earliest first) so the graph panel can show what was actually said.
  const claimRows = keptIds.size
    ? await db
        .select({ entityId: mentions.entityId, itemId: mentions.itemId, text: mentions.claimText, stance: mentions.stance, t: mentions.t })
        .from(mentions)
        .innerJoin(items, eq(items.id, mentions.itemId))
        .where(and(inArray(mentions.entityId, [...keptIds]), eq(items.status, "ready"), isNotNull(mentions.claimText)))
        .orderBy(mentions.t)
    : [];
  const claimsByEdge = new Map<string, GraphClaim[]>();
  for (const c of claimRows) {
    if (!c.text) continue;
    const key = `${c.entityId}:${c.itemId}`;
    const list = claimsByEdge.get(key) ?? [];
    if (list.length < 3) list.push({ text: c.text, stance: (c.stance as GraphClaim["stance"]) ?? null, t: c.t === null || c.t === undefined ? null : Number(c.t) });
    claimsByEdge.set(key, list);
  }

  const edges: GraphEdge[] = rows
    .filter((r) => keptIds.has(r.entityId))
    .map((r) => ({
      id: `${r.entityId}:${r.itemId}`,
      source: r.entityId,
      target: r.itemId,
      weight: Number(r.weight),
      stances: { supports: Number(r.supports), opposes: Number(r.opposes), neutral: Number(r.neutral) },
      t_first: r.tFirst === null || r.tFirst === undefined ? null : Number(r.tFirst),
      claims: claimsByEdge.get(`${r.entityId}:${r.itemId}`) ?? [],
    }));
  const itemDegree = new Map<string, number>();
  for (const e of edges) itemDegree.set(e.target, (itemDegree.get(e.target) ?? 0) + 1);

  const nodes: GraphNode[] = [
    ...readyItems.map((it) => ({
      id: it.id,
      type: "item" as const,
      label: it.title || it.sourceUrl,
      channel: it.channel,
      source_type: it.sourceType,
      source_url: it.sourceUrl,
      duration_s: it.durationS,
      published_at: it.publishedAt ? it.publishedAt.toISOString() : null,
      degree: itemDegree.get(it.id) ?? 0,
    })),
    ...kept.map((e) => {
      const p = perEntity.get(e.id)!;
      return {
        id: e.id,
        type: "entity" as const,
        label: e.name,
        kind: e.kind,
        url: e.url,
        aliases: e.aliases,
        degree: p.items.size,
        mentions: p.mentions,
        stances: p.stances,
        // Contested = the corpus both supports and opposes it somewhere (PRD §9: surface disagreements).
        contested: p.stances.supports > 0 && p.stances.opposes > 0,
      };
    }),
  ];
  return {
    namespace: { id: ns.id, name: ns.name },
    nodes,
    edges,
    stats: {
      items: readyItems.length,
      entities: kept.length,
      mentions: rows.reduce((n, r) => n + Number(r.weight), 0),
      edges: edges.length,
      contested: nodes.filter((n) => n.type === "entity" && n.contested).length,
      truncated_entities: ranked.length - kept.length,
    },
  };
}
