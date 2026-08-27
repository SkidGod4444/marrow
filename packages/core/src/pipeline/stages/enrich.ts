import { upsertEntityIndex } from "../../services/entities.ts";
import { chunk } from "../../util.ts";
import { isTextSource } from "../../ids.ts";
import { textContext, transcriptContext } from "../context.ts";
import { ENRICH_SYSTEM, EnrichmentSchema, RESOLVE_SYSTEM, ResolvedSchema, TEXT_ENRICH_SYSTEM } from "../prompts.ts";
import type { StageFn } from "../types.ts";

/** Stage 7 — references (resolved via web search), claims with stance, and the namespace entity index. */
export const enrichStage: StageFn = async (ctx) => {
  const { doc, item, namespace, db, providers, usage, log } = ctx;
  const text = isTextSource(doc.source_type);
  if (text ? !doc.body_md.trim() : !doc.transcript.length) return { skipped: text ? "no text" : "no transcript" };

  const ex = await providers.generate(
    { system: text ? TEXT_ENRICH_SYSTEM : ENRICH_SYSTEM, user: text ? textContext(doc) : transcriptContext(doc), schema: EnrichmentSchema, schemaName: "enrichment", effort: "low" },
    usage,
  );
  if (text) {
    for (const r of ex.references) r.t = null;
    for (const c of ex.claims) c.t = null;
  }
  log(`${ex.references.length} references, ${ex.claims.length} claims, ${ex.entities.length} entities`);

  const urlByName = new Map<string, string | null>();
  const unique = [...new Map(ex.references.map((r) => [r.name.toLowerCase(), r])).values()];
  for (const batch of chunk(unique, 12)) {
    const resolved = await providers.generate(
      {
        system: RESOLVE_SYSTEM,
        user: JSON.stringify(batch.map((b) => ({ name: b.name, kind: b.kind, search_query: b.search_query }))),
        schema: ResolvedSchema,
        schemaName: "resolutions",
        webSearch: true,
        effort: "low",
        verbosity: "low",
      },
      usage,
    );
    for (const r of resolved.resolutions) urlByName.set(r.name.toLowerCase(), r.resolved_url);
  }
  log(`resolved ${[...urlByName.values()].filter(Boolean).length}/${unique.length} references`);

  doc.references = ex.references.map((r) => ({
    kind: r.kind,
    name: r.name,
    raw_mention: r.raw_mention,
    t: r.t,
    resolved_url: urlByName.get(r.name.toLowerCase()) ?? null,
  }));
  doc.claims = ex.claims.map((c) => ({ entity: c.entity, claim_text: c.claim_text, stance: c.stance, t: c.t, quote: c.quote }));

  const stats = await upsertEntityIndex(db, { namespaceId: namespace.id, itemId: item.id, enrichment: ex, urls: urlByName });
  log(`entity index: ${stats.entities} entities touched, ${stats.mentions} mentions`);
};
