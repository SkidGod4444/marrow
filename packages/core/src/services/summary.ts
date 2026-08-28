import { and, count, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { type Db, entities, items, mentions, namespaces } from "../db/index.ts";
import { UsageTracker } from "../openai/client.ts";
import type { GenerateOpts } from "../openai/text.ts";
import { NamespaceSummarySchema, SUMMARY_SYSTEM } from "../pipeline/prompts.ts";

export type SummaryDeps = {
  db: Db;
  generate: <T extends z.ZodType>(opts: GenerateOpts<T>, usage: UsageTracker) => Promise<z.infer<T>>;
};

/** PRD §9: the standing namespace summary — what the corpus covers, themes, disagreements. */
export async function refreshNamespaceSummary(deps: SummaryDeps, namespaceId: string): Promise<{ summary: string; cost: number; usage: Record<string, number> }> {
  const { db } = deps;
  const ready = await db.select().from(items).where(and(eq(items.namespaceId, namespaceId), eq(items.status, "ready"))).orderBy(desc(items.createdAt)).limit(60);
  const ents = await db
    .select({
      name: entities.name,
      kind: entities.kind,
      mentions: count(mentions.id),
      supports: sql<number>`sum(case when ${mentions.stance} = 'supports' then 1 else 0 end)::int`,
      opposes: sql<number>`sum(case when ${mentions.stance} = 'opposes' then 1 else 0 end)::int`,
    })
    .from(entities)
    .leftJoin(mentions, eq(mentions.entityId, entities.id))
    .where(eq(entities.namespaceId, namespaceId))
    .groupBy(entities.id)
    .orderBy(desc(count(mentions.id)))
    .limit(40);
  const usage = new UsageTracker();
  const out = await deps.generate(
    {
      system: SUMMARY_SYSTEM,
      user: JSON.stringify({
        items: ready.map((i) => ({ title: i.title, channel: i.channel, summary: i.summary ?? "" })),
        entities: ents.map((e) => ({ name: e.name, kind: e.kind, mentions: Number(e.mentions), supports: Number(e.supports ?? 0), opposes: Number(e.opposes ?? 0) })),
      }),
      schema: NamespaceSummarySchema,
      schemaName: "namespace_summary",
      effort: "low",
      verbosity: "medium",
    },
    usage,
  );
  await db.update(namespaces).set({ summary: out.summary }).where(eq(namespaces.id, namespaceId));
  return { summary: out.summary, cost: usage.cost, usage: usage.usage };
}

export const SUMMARY_EVERY = 3;

/** Regenerate after every `SUMMARY_EVERY` ready items (or when there is none yet). Returns null when nothing was done. */
export async function maybeRefreshNamespaceSummary(deps: SummaryDeps, namespaceId: string): Promise<{ summary: string; cost: number; usage: Record<string, number> } | null> {
  const [ns] = await deps.db.select().from(namespaces).where(eq(namespaces.id, namespaceId));
  if (!ns) return null;
  const [row] = await deps.db.select({ n: sql<number>`count(*)::int` }).from(items).where(and(eq(items.namespaceId, namespaceId), eq(items.status, "ready")));
  const n = row?.n ?? 0;
  if (n === 0) return null;
  if (ns.summary && n % SUMMARY_EVERY !== 0) return null;
  return refreshNamespaceSummary(deps, namespaceId);
}
