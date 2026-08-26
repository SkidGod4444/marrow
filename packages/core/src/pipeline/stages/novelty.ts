import { and, eq, ne, sql } from "drizzle-orm";
import { items } from "../../db/index.ts";
import type { Novelty, VideoDocument } from "../../document.ts";
import { nearestSegments } from "../../services/search.ts";
import { fmtTs } from "../../timefmt.ts";
import { NOVELTY_SYSTEM, NoveltyLLMSchema } from "../prompts.ts";
import type { StageFn } from "../types.ts";

export const NOVELTY_MIN_ITEMS = 5;

type NoveltySection = Novelty["sections"][number];
/** Sections are weighted by duration so "~70% overlaps" is about time, not section count. */
const weight = (s: NoveltySection) => (s.t_start !== null && s.t_end !== null && s.t_end > s.t_start ? s.t_end - s.t_start : 1);
const span = (s: NoveltySection) => (s.t_start !== null ? `${fmtTs(s.t_start)}${s.t_end !== null ? `–${fmtTs(s.t_end)}` : ""} (${s.topic})` : s.topic);

type Section = { i: number; heading: string; t_start: number | null; t_end: number | null; excerpt: string };

/** The units we triage: article sections (preferred), else chapters, else the whole item. */
export function noveltySections(doc: VideoDocument): Section[] {
  const excerptFor = (t0: number | null, t1: number | null, fallback: string) => {
    if (t0 !== null && doc.transcript.length) {
      const hi = t1 ?? Number.POSITIVE_INFINITY;
      const text = doc.transcript.filter((e) => e.t_start >= t0 && e.t_start < hi).map((e) => e.text).join(" ");
      if (text) return text.slice(0, 700);
    }
    return fallback.slice(0, 700);
  };
  if (doc.article?.sections.length) {
    return doc.article.sections.map((s, i) => ({ i, heading: s.heading, t_start: s.t_start, t_end: s.t_end ?? null, excerpt: excerptFor(s.t_start, s.t_end ?? null, s.body_md) }));
  }
  if (doc.chapters.length) {
    return doc.chapters.map((c, i) => ({ i, heading: c.title, t_start: c.t_start, t_end: c.t_end, excerpt: excerptFor(c.t_start, c.t_end, "") }));
  }
  const whole = doc.transcript.map((e) => e.text).join(" ") || doc.article?.summary || doc.description;
  return whole ? [{ i: 0, heading: doc.title || "Whole item", t_start: doc.transcript[0]?.t_start ?? null, t_end: doc.duration_s || null, excerpt: whole.slice(0, 700) }] : [];
}

/** Stage 10 — PRD §10: per-section known/new classification against the rest of the namespace. */
export const noveltyStage: StageFn = async (ctx) => {
  const { db, doc, item, namespace, providers, usage, log } = ctx;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(items)
    .where(and(eq(items.namespaceId, namespace.id), eq(items.status, "ready"), ne(items.id, item.id)));
  const n = row?.n ?? 0;
  if (n < NOVELTY_MIN_ITEMS) return { skipped: `namespace has ${n} ready items (< ${NOVELTY_MIN_ITEMS})` };

  const sections = noveltySections(doc);
  if (!sections.length) return { skipped: "nothing to triage" };

  const vectors = await providers.embed(sections.map((s) => `${s.heading}\n${s.excerpt}`), usage);
  const matches = await Promise.all(sections.map((_s, i) => nearestSegments(db, namespace.id, vectors[i]!, { excludeItemId: item.id, k: 4 })));
  const titles = new Map<string, string>();
  for (const m of matches.flat()) titles.set(m.item_id, m.title);

  const verdictIn = await providers.generate(
    {
      system: NOVELTY_SYSTEM,
      user: JSON.stringify({
        title: doc.title,
        sections: sections.map((s, i) => ({
          i: s.i,
          heading: s.heading,
          span: s.t_start !== null ? `${fmtTs(s.t_start)}–${s.t_end !== null ? fmtTs(s.t_end) : "end"}` : null,
          excerpt: s.excerpt,
          matches: matches[i]!.map((m) => ({ item_id: m.item_id, title: m.title, t: m.t_start, text: m.text.slice(0, 400) })),
        })),
      }),
      schema: NoveltyLLMSchema,
      schemaName: "novelty",
      effort: "low",
    },
    usage,
  );

  const byIndex = new Map(verdictIn.sections.map((s) => [s.i, s]));
  const out: Novelty["sections"] = sections.map((s) => {
    const v = byIndex.get(s.i);
    return {
      t_start: s.t_start,
      t_end: s.t_end,
      topic: v?.topic ?? s.heading,
      label: v?.label ?? "new",
      covered_by: (v?.covered_by ?? []).filter((c) => titles.has(c.item_id)).map((c) => ({ item_id: c.item_id, title: titles.get(c.item_id)!, t: c.t })),
    };
  });
  const total = out.reduce((a, s) => a + weight(s), 0) || 1;
  const known = out.filter((s) => s.label === "known").reduce((a, s) => a + weight(s), 0);
  const ratio = Math.round((known / total) * 100) / 100;
  const fresh = out.filter((s) => s.label === "new");
  const covering = [...new Set(out.flatMap((s) => s.covered_by.map((c) => c.title)))];
  const verdict =
    fresh.length === 0
      ? `Fully covered by ${covering.slice(0, 3).join(", ") || "the corpus"}.`
      : ratio === 0
        ? `All new material: ${fresh.slice(0, 4).map(span).join("; ")}.`
        : `~${Math.round(ratio * 100)}% overlaps existing corpus${covering.length ? ` (${covering.slice(0, 3).join(", ")})` : ""}; new material: ${fresh.slice(0, 4).map(span).join("; ")}.`;

  const novelty: Novelty = { overlap_ratio: ratio, verdict, sections: out };
  doc.novelty = novelty;
  await db.update(items).set({ novelty, updatedAt: new Date() }).where(eq(items.id, item.id));
  log(`novelty: ${verdict}`);
};
