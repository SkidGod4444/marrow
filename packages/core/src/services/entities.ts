import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { type Db, type Entity, entities, items, mentions } from "../db/index.ts";
import { newId } from "../ids.ts";
import { deepLink } from "../timefmt.ts";
import { getNamespace } from "./namespaces.ts";
import type { Enrichment } from "../pipeline/prompts.ts";
import { chunk } from "../util.ts";

const keyOf = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

type Spec = { name: string; kind: string; aliases: Set<string>; url: string | null };

/** Merge one item's enrichment into the namespace entity index (PRD §9) and replace its mentions. */
export async function upsertEntityIndex(
  db: Db,
  input: { namespaceId: string; itemId: string; enrichment: Enrichment; urls: Map<string, string | null> },
): Promise<{ entities: number; mentions: number }> {
  const { namespaceId, itemId, enrichment, urls } = input;
  const specs = new Map<string, Spec>();
  const add = (name: string, kind: string, aliases: string[] = [], url: string | null = null) => {
    const k = keyOf(name);
    if (!k) return;
    const s = specs.get(k) ?? { name: name.trim(), kind, aliases: new Set<string>(), url: null };
    for (const a of aliases) if (keyOf(a) !== k) s.aliases.add(a.trim());
    s.url ??= url;
    specs.set(k, s);
  };
  for (const e of enrichment.entities) add(e.name, e.kind, e.aliases);
  for (const r of enrichment.references) add(r.name, r.kind, [r.raw_mention], urls.get(r.name.toLowerCase()) ?? null);
  for (const c of enrichment.claims) if (c.entity) add(c.entity, "other");

  const keys = [...specs.keys()];
  const existing = keys.length
    ? await db.select().from(entities).where(and(eq(entities.namespaceId, namespaceId), inArray(entities.nameKey, keys)))
    : [];
  const byKey = new Map<string, Entity>(existing.map((e) => [e.nameKey, e]));

  for (const [k, spec] of specs) {
    const cur = byKey.get(k);
    if (cur) {
      const aliases = [...new Set([...cur.aliases, ...spec.aliases])];
      const url = cur.url ?? spec.url;
      if (aliases.length !== cur.aliases.length || url !== cur.url) {
        await db.update(entities).set({ aliases, url }).where(eq(entities.id, cur.id));
        byKey.set(k, { ...cur, aliases, url });
      }
    } else {
      const [row] = await db
        .insert(entities)
        .values({ id: newId("ent"), namespaceId, name: spec.name, nameKey: k, aliases: [...spec.aliases], url: spec.url, kind: spec.kind })
        .returning();
      byKey.set(k, row!);
    }
  }

  await db.delete(mentions).where(eq(mentions.itemId, itemId));
  const rows = [
    ...enrichment.references.flatMap((r) => {
      const ent = byKey.get(keyOf(r.name));
      return ent ? [{ id: newId("men"), entityId: ent.id, itemId, t: r.t, quote: r.raw_mention, claimText: null, stance: null }] : [];
    }),
    ...enrichment.claims.flatMap((c) => {
      const ent = c.entity ? byKey.get(keyOf(c.entity)) : undefined;
      return ent ? [{ id: newId("men"), entityId: ent.id, itemId, t: c.t, quote: c.quote, claimText: c.claim_text, stance: c.stance }] : [];
    }),
  ];
  for (const batch of chunk(rows, 200)) await db.insert(mentions).values(batch);
  return { entities: byKey.size, mentions: rows.length };
}

// ---- PRD §8 `lookup_entity` ----

export type EntityMention = {
  item_id: string;
  title: string;
  source_url: string;
  t: number | null;
  deep_link: string;
  quote: string | null;
  claim_text: string | null;
  stance: "supports" | "opposes" | "neutral" | null;
};

export type EntityLookup = {
  entity: Entity;
  mentions: EntityMention[];
  items: number;
  stances: { supports: number; opposes: number; neutral: number };
  /** Claims only, grouped by stance — the "A claims essential @12:10; B argues it's a crutch @22:10" view. */
  claims: { supports: EntityMention[]; opposes: EntityMention[]; neutral: EntityMention[] };
};

export async function lookupEntity(db: Db, input: { namespace: string; name: string }): Promise<{ result: EntityLookup | null; suggestions: string[] }> {
  const ns = await getNamespace(db, input.namespace);
  if (!ns) throw new Error(`namespace "${input.namespace}" not found`);
  const key = keyOf(input.name);
  let [entity] = await db.select().from(entities).where(and(eq(entities.namespaceId, ns.id), eq(entities.nameKey, key)));
  if (!entity) {
    const like = `%${key.replace(/[%_]/g, "")}%`;
    const candidates = await db
      .select()
      .from(entities)
      .where(and(eq(entities.namespaceId, ns.id), or(ilike(entities.nameKey, like), sql`lower(${entities.aliases}::text) like ${like}`)))
      .limit(6);
    const exactAlias = candidates.find((c) => c.aliases.some((a) => keyOf(a) === key));
    entity = exactAlias ?? (candidates.length === 1 ? candidates[0] : undefined);
    if (!entity) return { result: null, suggestions: candidates.map((c) => c.name) };
  }

  const rows = await db
    .select({ m: mentions, item: items })
    .from(mentions)
    .innerJoin(items, eq(items.id, mentions.itemId))
    .where(eq(mentions.entityId, entity.id))
    .orderBy(items.createdAt, mentions.t);
  const ms: EntityMention[] = rows.map(({ m, item }) => ({
    item_id: item.id,
    title: item.title,
    source_url: item.sourceUrl,
    t: m.t,
    deep_link: deepLink(item.sourceUrl, m.t),
    quote: m.quote,
    claim_text: m.claimText,
    stance: (m.stance as EntityMention["stance"]) ?? null,
  }));
  const claims = {
    supports: ms.filter((m) => m.claim_text && m.stance === "supports"),
    opposes: ms.filter((m) => m.claim_text && m.stance === "opposes"),
    neutral: ms.filter((m) => m.claim_text && m.stance === "neutral"),
  };
  return {
    result: {
      entity,
      mentions: ms,
      items: new Set(ms.map((m) => m.item_id)).size,
      stances: { supports: claims.supports.length, opposes: claims.opposes.length, neutral: claims.neutral.length },
      claims,
    },
    suggestions: [],
  };
}

export async function listEntities(db: Db, namespaceId: string, limit = 200): Promise<Array<Entity & { mentionCount: number }>> {
  const rows = await db
    .select({ e: entities, n: count(mentions.id) })
    .from(entities)
    .leftJoin(mentions, eq(mentions.entityId, entities.id))
    .where(eq(entities.namespaceId, namespaceId))
    .groupBy(entities.id)
    .orderBy(desc(count(mentions.id)), entities.name)
    .limit(limit);
  return rows.map((r) => ({ ...r.e, mentionCount: Number(r.n) }));
}
