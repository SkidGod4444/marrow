import { eq } from "drizzle-orm";
import { type Db, items } from "../db/index.ts";
import type { VideoDocument } from "../document.ts";
import { isTextSource } from "../ids.ts";
import { toDialogue } from "../pipeline/speakers.ts";
import { deepLink, fmtTs } from "../timefmt.ts";
import type { Storage } from "../storage/index.ts";
import { getDocument } from "./documents.ts";
import { listEntities } from "./entities.ts";
import { listItems } from "./items.ts";
import { getNamespace } from "./namespaces.ts";

const yq = (s: string) => JSON.stringify(s);
const link = (doc: VideoDocument, t: number | null | undefined) => (t === null || t === undefined ? "" : `[${fmtTs(t)}](${deepLink(doc.source_url, t)})`);

/** PRD §8 `export_markdown(video_id)`: clean markdown with clickable timestamp links (Obsidian/Notion-ready). */
export function documentToMarkdown(doc: VideoDocument, opts: { transcript?: boolean; frontmatter?: boolean } = {}): string {
  const out: string[] = [];
  const text = isTextSource(doc.source_type);
  if (opts.frontmatter ?? true) {
    // YAML properties: Obsidian shows them as a properties block and they make the note filterable.
    out.push("---", `title: ${yq(doc.title || doc.id)}`, `source: ${yq(doc.source_url)}`, `type: ${doc.source_type}`);
    if (doc.channel) out.push(`${text ? "site" : "channel"}: ${yq(doc.channel)}`);
    if (doc.author) out.push(`author: ${yq(doc.author)}`);
    if (doc.published_at) out.push(`published: ${doc.published_at.slice(0, 10)}`);
    if (doc.duration_s) out.push(`duration: ${yq(fmtTs(doc.duration_s))}`);
    out.push("tags:", "  - marrow", `  - marrow/${doc.source_type.replace(/_/g, "-")}`, "---", "");
  }
  out.push(`# ${doc.title || doc.id}`);
  const meta = [doc.author && `**${doc.author}**`, doc.channel && (text ? doc.channel : `**${doc.channel}**`), doc.published_at && doc.published_at.slice(0, 10), doc.duration_s && fmtTs(doc.duration_s), /^https?:/.test(doc.source_url) ? `[source](${doc.source_url})` : null].filter(Boolean);
  out.push(meta.join(" · "), "");
  if (doc.article) {
    out.push("## Summary", "", doc.article.summary, "");
    if (doc.article.takeaways.length) out.push("## Takeaways", "", ...doc.article.takeaways.map((t) => `- ${t}`), "");
    for (const s of doc.article.sections) {
      const ts = link(doc, s.t_start);
      out.push(`## ${ts ? `${ts} ` : ""}${s.heading}`, "", s.body_md.trim(), "");
    }
  } else if (doc.chapters.length) {
    out.push("## Chapters", "", ...doc.chapters.map((c) => `- ${link(doc, c.t_start)} ${c.title}`), "");
  }
  if (doc.references.length) {
    out.push("## References", "");
    for (const r of doc.references) {
      const name = r.resolved_url ? `[${r.name}](${r.resolved_url})` : r.name;
      out.push(`- ${name} — ${r.kind}${r.t !== null && r.t !== undefined ? ` · ${link(doc, r.t)}` : ""}`);
    }
    out.push("");
  }
  if (doc.claims.length) {
    out.push("## Claims", "", ...doc.claims.map((c) => `- ${c.stance === "supports" ? "✅" : c.stance === "opposes" ? "❌" : "•"} ${c.claim_text}${c.entity ? ` _(${c.entity})_` : ""}${c.t !== null ? ` · ${link(doc, c.t)}` : ""}`), "");
  }
  if (doc.novelty) out.push("## Novelty", "", doc.novelty.verdict, "");
  if (opts.transcript && text && doc.body_md.trim()) out.push("## Original text", "", doc.body_md.trim(), "");
  if (opts.transcript && doc.transcript.length) {
    out.push("## Transcript", "");
    const label = speakerLabels(doc);
    const multi = new Set(doc.transcript.map((e) => e.speaker)).size > 1;
    for (const p of toDialogue(doc.transcript)) {
      out.push(`${multi ? `**${label(p.speaker)}** ` : ""}${link(doc, p.t_start)}  \n${p.text}`, "");
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function speakerLabels(doc: VideoDocument): (id: string) => string {
  const m = new Map(doc.speakers.map((s) => [s.id, s.label]));
  return (id) => m.get(id) ?? id;
}

/** Plain text: readable as-is, shareable anywhere. `[MM:SS] Speaker: text` paragraphs after the summary. */
export function documentToText(doc: VideoDocument, opts: { transcript?: boolean } = {}): string {
  const out: string[] = [doc.title || doc.id];
  const meta = [doc.author, doc.channel, doc.published_at?.slice(0, 10), doc.duration_s ? fmtTs(doc.duration_s) : null, /^https?:/.test(doc.source_url) ? doc.source_url : null].filter(Boolean);
  out.push(meta.join(" · "), "");
  if (doc.article) {
    out.push("SUMMARY", doc.article.summary, "");
    if (doc.article.takeaways.length) out.push("TAKEAWAYS", ...doc.article.takeaways.map((t) => `- ${t}`), "");
  }
  if (doc.speakers.length > 1) out.push("SPEAKERS", ...doc.speakers.map((s) => `${s.id}: ${s.label}`), "");
  if ((opts.transcript ?? true) && isTextSource(doc.source_type) && doc.body_md.trim()) out.push("TEXT", "", doc.body_md.trim(), "");
  if ((opts.transcript ?? true) && doc.transcript.length) {
    out.push("TRANSCRIPT", "");
    const label = speakerLabels(doc);
    const multi = new Set(doc.transcript.map((e) => e.speaker)).size > 1;
    for (const p of toDialogue(doc.transcript)) out.push(`[${fmtTs(p.t_start)}]${multi ? ` ${label(p.speaker)}:` : ""} ${p.text}`, "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export async function exportItemText(deps: { db: Db; storage: Storage }, itemId: string, opts: { transcript?: boolean } = {}): Promise<string | null> {
  const doc = await getDocument(deps.storage, itemId);
  return doc ? documentToText(doc, opts) : null;
}

export async function exportItemMarkdown(deps: { db: Db; storage: Storage }, itemId: string, opts: { transcript?: boolean } = {}): Promise<string | null> {
  const [item] = await deps.db.select().from(items).where(eq(items.id, itemId));
  if (!item) return null;
  const doc = await getDocument(deps.storage, itemId);
  if (!doc) return null;
  return documentToMarkdown(doc, opts);
}

/** `export_markdown(namespace_id)`: an index note — every ready item with its summary, plus the entity index. */
export async function exportNamespaceMarkdown(deps: { db: Db; storage: Storage }, ref: string): Promise<string | null> {
  const ns = await getNamespace(deps.db, ref);
  if (!ns) return null;
  const out: string[] = [`# ${ns.name}`, ""];
  if (ns.description) out.push(ns.description, "");
  if (ns.summary) out.push("## Corpus summary", "", ns.summary, "");
  const ready = await listItems(deps.db, ns.id, "ready");
  out.push(`## Items (${ready.length})`, "");
  for (const it of ready) {
    const doc = await getDocument(deps.storage, it.id);
    out.push(`### [${it.title || it.id}](${it.sourceUrl})`, "");
    if (it.channel) out.push(`_${it.channel}_${it.durationS ? ` · ${fmtTs(it.durationS)}` : ""}`, "");
    if (doc?.article?.summary) out.push(doc.article.summary, "");
    if (doc?.article?.takeaways.length) out.push(...doc.article.takeaways.slice(0, 5).map((t) => `- ${t}`), "");
  }
  const ents = await listEntities(deps.db, ns.id, 100);
  if (ents.length) {
    out.push("## Entity index", "", "| Entity | Kind | Mentions | Link |", "|---|---|---|---|");
    for (const e of ents) out.push(`| ${e.name} | ${e.kind} | ${e.mentionCount} | ${e.url ? `[link](${e.url})` : ""} |`);
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
