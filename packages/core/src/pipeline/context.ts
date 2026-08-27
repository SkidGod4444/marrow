import type { VideoDocument } from "../document.ts";
import { fmtTs, transcriptLines } from "../timefmt.ts";

/**
 * The static, cache-friendly prefix shared by the LLM pipeline passes and per-video chat (PRD §6.1):
 * metadata + chapters + "[MM:SS] text" transcript lines. Frames are appended as text by `frameLines`.
 */
export function transcriptContext(doc: VideoDocument): string {
  const head = [
    `Title: ${doc.title}`,
    doc.channel ? `Channel: ${doc.channel}` : null,
    `Duration: ${fmtTs(doc.duration_s)}`,
    doc.language ? `Language: ${doc.language}` : null,
    doc.chapters.length ? `Chapters:\n${doc.chapters.map((c) => `- [${fmtTs(c.t_start)}] ${c.title}`).join("\n")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${head}\n\nTRANSCRIPT:\n${transcriptLines(doc.transcript)}`;
}

/** Text sources (PRD §7): metadata + the readable body instead of a transcript. */
export function textContext(doc: VideoDocument): string {
  const head = [
    `Title: ${doc.title}`,
    doc.author ? `Author: ${doc.author}` : null,
    doc.channel ? `Source: ${doc.channel}` : null,
    doc.published_at ? `Published: ${doc.published_at.slice(0, 10)}` : null,
    `URL: ${doc.source_url}`,
    doc.description ? `Note: ${doc.description}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return `${head}\n\nTEXT:\n${doc.body_md}`;
}

/** Whichever the item has: transcript lines for media, the body for text sources. */
export function documentContext(doc: VideoDocument): string {
  return doc.transcript.length || !doc.body_md ? transcriptContext(doc) : textContext(doc);
}

export function frameLines(doc: VideoDocument): string {
  if (!doc.frames.length) return "";
  return `KEYFRAMES (timestamp — caption):\n${doc.frames.map((f) => `- [${fmtTs(f.t)}] ${f.caption ?? "(no caption)"}`).join("\n")}`;
}

export function referenceLines(doc: VideoDocument): string {
  if (!doc.references.length) return "";
  return `REFERENCES:\n${doc.references
    .map((r) => `- ${r.name} (${r.kind})${r.t !== null && r.t !== undefined ? ` @ ${fmtTs(r.t)}` : ""}${r.resolved_url ? ` — ${r.resolved_url}` : ""}`)
    .join("\n")}`;
}
