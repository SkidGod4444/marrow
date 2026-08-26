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
