import { and, eq, inArray } from "drizzle-orm";
import { type Db, type Entity, entities, mentions } from "../db/index.ts";
import { newId } from "../ids.ts";
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
