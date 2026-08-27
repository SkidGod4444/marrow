import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { extractYouTubeUrls } from "../capture/links.ts";
import { type PageContent, isSocialUrl, looksLikePaper, normalizeCaptureUrl } from "../capture/page.ts";
import { type Db, type Item, type Job, items } from "../db/index.ts";
import { newDocument } from "../document.ts";
import { type SourceType, isTextSource } from "../ids.ts";
import { isYouTubeUrl } from "../media/ytdlp.ts";
import { loadDocument, saveDocument } from "../pipeline/runner.ts";
import type { JobQueue } from "../queue.ts";
import type { Storage } from "../storage/index.ts";
import { createIngest } from "./ingest.ts";
import { getNamespace } from "./namespaces.ts";

// PRD §7: POST /capture {namespace, url?, text?, author?, note?} → captured_post (or newsletter/paper) document →
// enrichment → segments. The readable text is fetched here, synchronously (share a link from the phone, it is
// searchable in under a minute); the pipeline then runs article → enrich → segment → novelty on it.

export type CaptureInput = {
  namespace: string;
  url?: string;
  text?: string;
  title?: string;
  author?: string;
  /** Owner's note about why this was captured — stored as the item description, shown in the reader. */
  note?: string;
  source_type?: Extract<SourceType, "captured_post" | "newsletter" | "paper">;
  published_at?: string | null;
  force?: boolean;
};

export type CaptureDeps = { db: Db; storage: Storage; queue?: JobQueue; fetchPage: (url: string) => Promise<PageContent> };

export type CaptureResult = {
  item: Item;
  job: Job;
  reused: boolean;
  /** YouTube videos linked from the text; queued for ingestion when the namespace has `auto_ingest_links`, otherwise offered. */
  linked_videos: string[];
  queued_videos: Array<{ url: string; job_id: string; item_id: string }>;
};

const hashText = (s: string) => createHash("sha256").update(s.trim().replace(/\s+/g, " ")).digest("hex").slice(0, 24);

/** Pasted text without a URL is keyed by its content hash so re-sharing the same post is idempotent (PRD §5). */
export function textSourceUrl(text: string): string {
  return `marrow:text:${hashText(text)}`;
}

export async function createCapture(deps: CaptureDeps, input: CaptureInput): Promise<CaptureResult> {
  const { db, storage } = deps;
  const ns = await getNamespace(db, input.namespace);
  if (!ns) throw new Error(`namespace "${input.namespace}" not found`);
  const text = input.text?.trim() ?? "";
  const rawUrl = input.url?.trim() ?? "";
  if (!text && !rawUrl) throw new Error("capture needs a url or some text");

  // A bare YouTube link is a video, not a text capture.
  if (!text && rawUrl && isYouTubeUrl(rawUrl)) {
    const res = await createIngest(db, { namespace: ns.id, url: rawUrl, force: input.force });
    if (!res.reused || res.job.state !== "done") await deps.queue?.enqueue(res.job.id);
    return { ...res, linked_videos: [], queued_videos: [] };
  }

  const url = rawUrl ? normalizeCaptureUrl(rawUrl) : "";
  let page: PageContent | null = null;
  if (url && !text) {
    if (isSocialUrl(url)) throw new Error("social posts can't be fetched — share the post text along with the link");
    page = await deps.fetchPage(url);
    if (page.body_md.trim().length < 80) throw new Error("couldn't extract readable text from that page — share the text itself");
  }
  const body = text || page!.body_md;
  const sourceType: SourceType = input.source_type ?? (url && looksLikePaper(url) ? "paper" : "captured_post");
  if (!isTextSource(sourceType)) throw new Error(`"${sourceType}" is not a text source type`);
  const sourceUrl = url || textSourceUrl(body);

  const res = await createIngest(db, { namespace: ns.id, url: sourceUrl, sourceType, force: input.force });
  const fresh = !res.reused || res.job.state !== "done";
  if (fresh) {
    // Seed the document the runner will pick up (same version as the job): body + metadata; the fetch stage is then a no-op.
    const existing = res.job.version > 1 ? await loadDocument(storage, res.item.id) : null;
    const doc = newDocument({ id: res.item.id, namespace_id: ns.id, source_type: sourceType, source_url: sourceUrl, version: res.job.version });
    doc.has_video = false;
    doc.body_md = body;
    doc.title = (input.title?.trim() || page?.title || existing?.title || titleFromText(body) || sourceUrl).slice(0, 300);
    doc.author = (input.author?.trim() || page?.author || existing?.author || "").slice(0, 200);
    doc.channel = page?.site_name || existing?.channel || (url ? hostOf(url) : "") || (input.author?.trim() ?? "");
    doc.description = (input.note?.trim() || page?.description || existing?.description || "").slice(0, 5000);
    doc.published_at = input.published_at ?? page?.published_at ?? existing?.published_at ?? null;
    doc.linked_videos = extractYouTubeUrls(body, page?.links);
    await saveDocument(storage, doc);
    await db.update(items).set({ title: doc.title, channel: doc.channel, publishedAt: doc.published_at ? new Date(doc.published_at) : null, updatedAt: new Date() }).where(eq(items.id, res.item.id));
    await deps.queue?.enqueue(res.job.id);
  }

  const linked = fresh ? extractYouTubeUrls(body, page?.links) : ((await loadDocument(storage, res.item.id))?.linked_videos ?? []);
  const queued: CaptureResult["queued_videos"] = [];
  if (fresh && ns.flags?.auto_ingest_links) {
    for (const v of linked.slice(0, 5)) {
      const r = await createIngest(db, { namespace: ns.id, url: v });
      if (!r.reused || r.job.state !== "done") await deps.queue?.enqueue(r.job.id);
      queued.push({ url: v, job_id: r.job.id, item_id: r.item.id });
    }
  }
  const [item] = await db.select().from(items).where(eq(items.id, res.item.id));
  return { item: item ?? res.item, job: res.job, reused: res.reused, linked_videos: linked, queued_videos: queued };
}

function titleFromText(body: string): string {
  const line = body.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) ?? "";
  return line.length > 120 ? `${line.slice(0, 117).trimEnd()}…` : line;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};
