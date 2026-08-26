import { z } from "zod";
import { SOURCE_TYPES } from "./ids.ts";

// Canonical video document (PRD §4.3). One JSON per media item in object storage.

export const WordSchema = z.object({ w: z.string(), t: z.number(), t_end: z.number().optional() });
export type Word = z.infer<typeof WordSchema>;

export const TranscriptEntrySchema = z.object({
  t_start: z.number(),
  t_end: z.number(),
  speaker: z.string().default("S1"),
  text: z.string(),
  words: z.array(WordSchema).default([]),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

export const ChapterSchema = z.object({ title: z.string(), t_start: z.number(), t_end: z.number() });
export type Chapter = z.infer<typeof ChapterSchema>;

export const SpeakerSchema = z.object({ id: z.string(), label: z.string() });

export const FrameSchema = z.object({
  id: z.string(),
  t: z.number(),
  s3_key: z.string(),
  caption: z.string().optional(),
  ocr_text: z.string().optional(),
  scene_score: z.number().optional(),
});
export type Frame = z.infer<typeof FrameSchema>;

export const REFERENCE_KINDS = ["paper", "tool", "repo", "person", "technique", "dataset", "other"] as const;
export const ReferenceSchema = z.object({
  kind: z.enum(REFERENCE_KINDS),
  name: z.string(),
  raw_mention: z.string(),
  resolved_url: z.string().nullable().optional(),
  t: z.number().nullable().optional(),
});
export type Reference = z.infer<typeof ReferenceSchema>;

export const ClaimSchema = z.object({
  entity: z.string().nullable(),
  claim_text: z.string(),
  stance: z.enum(["supports", "opposes", "neutral"]),
  t: z.number().nullable(),
  quote: z.string().default(""),
});
export type Claim = z.infer<typeof ClaimSchema>;

export const ArticleSectionSchema = z.object({
  heading: z.string(),
  t_start: z.number().nullable(),
  t_end: z.number().nullable().optional(),
  body_md: z.string(),
});
export const ArticleSchema = z.object({
  summary: z.string(),
  takeaways: z.array(z.string()),
  sections: z.array(ArticleSectionSchema),
});
export type Article = z.infer<typeof ArticleSchema>;

export const ExpressionSchema = z.object({
  text: z.string(),
  kind: z.enum(["idiom", "phrasal_verb", "collocation", "slang", "other"]),
  t_start: z.number(),
  t_end: z.number(),
  explanation: z.string(),
  clip_s3_key: z.string().optional(),
});
export const LanguagePackSchema = z.object({ expressions: z.array(ExpressionSchema) });

export const NoveltySectionSchema = z.object({
  t_start: z.number().nullable(),
  t_end: z.number().nullable(),
  topic: z.string(),
  label: z.enum(["known", "new"]),
  covered_by: z.array(z.object({ item_id: z.string(), title: z.string(), t: z.number().nullable() })).default([]),
});
export const NoveltySchema = z.object({
  overlap_ratio: z.number(),
  verdict: z.string(),
  sections: z.array(NoveltySectionSchema),
});
export type Novelty = z.infer<typeof NoveltySchema>;

export const STAGE_NAMES = [
  "fetch", "transcribe", "diarize", "frames", "vision", "article", "enrich", "segment", "language", "novelty",
] as const;
export type StageName = (typeof STAGE_NAMES)[number];

export const VideoDocumentSchema = z.object({
  id: z.string(),
  namespace_id: z.string(),
  source_type: z.enum(SOURCE_TYPES),
  source_url: z.string(),
  title: z.string().default(""),
  channel: z.string().default(""),
  description: z.string().default(""),
  published_at: z.string().nullable().default(null),
  duration_s: z.number().default(0),
  language: z.string().nullable().default(null),
  has_video: z.boolean().default(true),
  chapters: z.array(ChapterSchema).default([]),
  speakers: z.array(SpeakerSchema).default([]),
  transcript: z.array(TranscriptEntrySchema).default([]),
  frames: z.array(FrameSchema).default([]),
  references: z.array(ReferenceSchema).default([]),
  claims: z.array(ClaimSchema).default([]),
  article: ArticleSchema.nullable().default(null),
  language_pack: LanguagePackSchema.nullable().default(null),
  novelty: NoveltySchema.nullable().default(null),
  pipeline: z.object({
    version: z.number().default(1),
    stages_completed: z.array(z.enum(STAGE_NAMES)).default([]),
  }),
});
export type VideoDocument = z.infer<typeof VideoDocumentSchema>;

export function newDocument(init: {
  id: string;
  namespace_id: string;
  source_type: VideoDocument["source_type"];
  source_url: string;
  version: number;
}): VideoDocument {
  return VideoDocumentSchema.parse({
    id: init.id,
    namespace_id: init.namespace_id,
    source_type: init.source_type,
    source_url: init.source_url,
    pipeline: { version: init.version, stages_completed: [] },
  });
}

export const documentKey = (itemId: string) => `documents/${itemId}.json`;
export const audioKey = (itemId: string) => `audio/${itemId}.ogg`;
export const rawPrefix = (itemId: string) => `raw/${itemId}/`;
export const frameKey = (itemId: string, t: number) => `frames/${itemId}/${Math.round(t * 10) / 10}.jpg`;
export const clipKey = (itemId: string, n: number) => `clips/${itemId}/${n}.m4a`;
