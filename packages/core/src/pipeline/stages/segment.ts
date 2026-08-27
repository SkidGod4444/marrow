import { eq } from "drizzle-orm";
import { segments } from "../../db/index.ts";
import { newId } from "../../ids.ts";
import { chunk } from "../../util.ts";
import { buildSegments, paragraphsToEntries } from "../segmenter.ts";
import type { StageFn } from "../types.ts";

/** Stage 8 — retrieval units: segments + embeddings; the FTS vector is a generated column. Replaces prior segments. */
export const segmentStage: StageFn = async (ctx) => {
  const { doc, item, namespace, db, providers, usage, log } = ctx;
  const entries = doc.transcript.length
    ? doc.transcript.map((e) => ({ t_start: e.t_start, t_end: e.t_end, text: e.text }))
    : paragraphsToEntries(doc.body_md || doc.article?.sections.map((s) => s.body_md).join("\n\n") || doc.description);
  if (!entries.length) return { skipped: "nothing to segment" };

  const segs = buildSegments(entries, { chapters: doc.chapters, frames: doc.frames });
  log(`${segs.length} segments — embedding`);
  const vectors = await providers.embed(segs.map((s) => `${doc.title}\n${s.text}`), usage);

  await db.transaction(async (tx) => {
    await tx.delete(segments).where(eq(segments.itemId, item.id));
    const rows = segs.map((s, i) => ({
      id: newId("seg"),
      itemId: item.id,
      namespaceId: namespace.id,
      sourceType: doc.source_type,
      position: i,
      tStart: s.t_start,
      tEnd: s.t_end,
      text: s.text,
      frameIds: s.frame_ids,
      embedding: vectors[i] ?? null,
    }));
    for (const batch of chunk(rows, 100)) await tx.insert(segments).values(batch);
  });
};
