import { ArticleSchema } from "../../document.ts";
import { isTextSource } from "../../ids.ts";
import { textContext, transcriptContext } from "../context.ts";
import { ARTICLE_SYSTEM, TEXT_ARTICLE_SYSTEM } from "../prompts.ts";
import type { StageFn } from "../types.ts";

/** Stage 6 — cheap LLM turns the transcript (or a captured text) into summary + takeaways + sections (the reader's input). */
export const articleStage: StageFn = async (ctx) => {
  const { doc, providers, usage, log } = ctx;
  if (isTextSource(doc.source_type)) {
    if (!doc.body_md.trim()) return { skipped: "no text" };
    const article = await providers.generate(
      { system: TEXT_ARTICLE_SYSTEM, user: textContext(doc), schema: ArticleSchema, schemaName: "article", effort: "low", verbosity: "high" },
      usage,
    );
    article.sections = article.sections.map((s) => ({ ...s, t_start: null, t_end: null }));
    doc.article = article;
    log(`article: ${article.sections.length} sections, ${article.takeaways.length} takeaways`);
    return;
  }
  if (!doc.transcript.length) return { skipped: "no transcript" };
  const article = await providers.generate(
    { system: ARTICLE_SYSTEM, user: transcriptContext(doc), schema: ArticleSchema, schemaName: "article", effort: "low", verbosity: "high" },
    usage,
  );
  // Sections must be chronological and inside the video; clamp anything the model got slightly wrong.
  article.sections = article.sections
    .map((s) => ({ ...s, t_start: s.t_start === null ? null : Math.min(Math.max(0, s.t_start), doc.duration_s || s.t_start) }))
    .sort((a, b) => (a.t_start ?? 0) - (b.t_start ?? 0));
  for (let i = 0; i < article.sections.length; i++) {
    const s = article.sections[i]!;
    if (s.t_end === undefined || s.t_end === null) s.t_end = article.sections[i + 1]?.t_start ?? doc.duration_s ?? null;
  }
  doc.article = article;
  log(`article: ${article.sections.length} sections, ${article.takeaways.length} takeaways`);
};
