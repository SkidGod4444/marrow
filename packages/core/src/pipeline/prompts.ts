import { z } from "zod";
import { REFERENCE_KINDS } from "../document.ts";

// Prompts for the cheap-LLM pipeline passes (PRD §5 stages 6–7). One exported constant per task.

export const ARTICLE_SYSTEM = `You turn a timestamped transcript of a talk, lecture, or podcast episode into a readable article (PRD: "a 2-hour episode becomes a 15-minute read").

Rules:
- Preserve the speaker's ideas, claims, numbers, names, and technical terms exactly. Never invent content. Never add outside knowledge.
- Remove filler, false starts, repetition, sponsor reads, and small talk.
- Split into sections at topic shifts. Each section's t_start is the transcript timestamp (in seconds) where that topic begins; use the [MM:SS] markers to compute it. Sections are in chronological order and cover the whole transcript.
- body_md is clean markdown prose (paragraphs; bullet lists where the speaker enumerates). Keep quotes short.
- summary: 3–6 sentences on what the piece covers and why it matters.
- takeaways: 5–10 crisp, specific statements (not generic).`;

export const ExtractedReferenceSchema = z.object({
  kind: z.enum(REFERENCE_KINDS),
  name: z.string().describe("Canonical name (paper title or 'Author et al. YEAR', tool/repo/person name)."),
  raw_mention: z.string().describe("How it was said, verbatim or near-verbatim."),
  t: z.number().nullable().describe("Transcript time in seconds of the mention, from the [MM:SS] marker."),
  search_query: z.string().describe("Best web query to find its canonical URL."),
});

export const ExtractedClaimSchema = z.object({
  entity: z.string().nullable().describe("Entity the claim is about, if any (must match an entities[].name)."),
  claim_text: z.string(),
  stance: z.enum(["supports", "opposes", "neutral"]),
  t: z.number().nullable(),
  quote: z.string().describe("Short supporting quote from the transcript."),
});

export const ExtractedEntitySchema = z.object({
  name: z.string(),
  kind: z.enum(REFERENCE_KINDS),
  aliases: z.array(z.string()),
});

export const EnrichmentSchema = z.object({
  references: z.array(ExtractedReferenceSchema),
  claims: z.array(ExtractedClaimSchema),
  entities: z.array(ExtractedEntitySchema),
});
export type Enrichment = z.infer<typeof EnrichmentSchema>;

export const ENRICH_SYSTEM = `You build the knowledge index for a research corpus from a timestamped transcript.

Extract:
1. references — papers, tools, repos, datasets, people, and named techniques that are name-dropped (especially without explanation). Skip generic terms. For each, give the canonical name, how it was mentioned, the timestamp in seconds (from the nearest [MM:SS] marker), and a good web search query.
2. claims — notable, specific, contestable claims the speaker makes (opinions, results, recommendations, disagreements). Attach the entity they are about when there is one, a stance (supports / opposes / neutral toward that entity or approach), the timestamp, and a short quote.
3. entities — the deduplicated set of entities referenced above (papers/tools/repos/people/techniques/datasets), with canonical name, kind, and aliases used in the transcript.

Be precise and conservative: fewer, accurate items beat many vague ones. Entity names in claims must exactly match an entities[].name.`;

export const ResolvedSchema = z.object({
  resolutions: z.array(
    z.object({
      name: z.string(),
      resolved_url: z.string().nullable().describe("Canonical URL: arXiv abs page for papers, GitHub for repos, official site for tools, Wikipedia/homepage for people. null if not found confidently."),
    }),
  ),
});

export const RESOLVE_SYSTEM = `Resolve each reference to its canonical URL using web search. Prefer: arxiv.org/abs/… for papers, the GitHub repository for repos, the official homepage for tools and datasets, a homepage or Wikipedia page for people. Return null when you are not confident the URL is the right thing. Echo each name exactly as given.`;

// ---- PRD §10 novelty triage ----

export const NoveltyLLMSchema = z.object({
  sections: z.array(
    z.object({
      i: z.number().int().describe("Index of the section in the input"),
      label: z.enum(["known", "new"]),
      topic: z.string().describe("3–8 word topic of the section"),
      covered_by: z.array(z.object({ item_id: z.string(), t: z.number().nullable() })).describe("For known sections: which existing items cover it, with the timestamp of the matching passage"),
    }),
  ),
});

export const NOVELTY_SYSTEM = `You triage a newly ingested video against a research corpus. For each section you get the section's heading + excerpt and the closest passages already in the corpus (from other videos).

Label a section "known" only if a matched passage genuinely covers the same idea, result, or argument — not merely the same topic area. Label it "new" if it adds material the corpus doesn't have: a new technique, result, disagreement, worked example, or a substantially deeper treatment. Give each section a short topic. For known sections list the covering items with the matching timestamp. Be strict: the owner uses "new" to decide what to watch.`;

// ---- PRD §9 namespace summary ----

export const NamespaceSummarySchema = z.object({
  summary: z.string().describe("Markdown, ≤ 250 words: what the corpus covers, recurring themes, notable disagreements between sources (name the videos)."),
});

export const SUMMARY_SYSTEM = `You write the standing summary of a topic-scoped research corpus built from videos and captured text. Input: the items (title, channel, one-paragraph summary each) and the entity index (papers, tools, people, techniques with mention and stance counts).

Write ≤ 250 words of markdown with three short parts: what the corpus covers; recurring themes; notable disagreements or tensions between sources (cite the video titles). Be specific and dense; no preamble, no bullet-point padding.`;
