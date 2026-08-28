import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { items } from "../../db/index.ts";
import { audioKey, rawPrefix } from "../../document.ts";
import { isTextSource } from "../../ids.ts";
import { extractYouTubeUrls } from "../../capture/links.ts";
import { isSocialUrl } from "../../capture/page.ts";
import { isYouTubeUrl, publishedAtFromUploadDate } from "../../media/ytdlp.ts";
import type { StageFn } from "../types.ts";

/**
 * Stage 1 — media: yt-dlp metadata + media (or a direct download for podcast enclosures), ffmpeg → mono low-bitrate
 * audio, raw video parked in storage for the frames stage. Text sources: make sure the readable body is present
 * (captures usually arrive with it; a bare URL is fetched here), then hand over to article/enrich/segment.
 */
export const fetchStage: StageFn = async (ctx) => {
  const { doc, item, providers, storage, workDir, db, log } = ctx;
  await mkdir(workDir, { recursive: true });

  if (isTextSource(doc.source_type)) return fetchText(ctx);

  const direct = !isYouTubeUrl(item.sourceUrl);
  let published: Date | null = null;
  if (direct) {
    // Podcast enclosure / uploaded media: the feed already gave us title, author and date (stored on the item).
    log("direct media URL — keeping feed metadata");
    doc.title = doc.title || item.title;
    doc.channel = doc.channel || item.channel;
    published = item.publishedAt ?? (doc.published_at ? new Date(doc.published_at) : null);
    doc.published_at = published ? published.toISOString() : null;
  } else {
    log("fetching metadata");
    const meta = await providers.fetchMetadata(item.sourceUrl, log);
    doc.title = meta.title ?? doc.title;
    doc.channel = meta.channel ?? meta.uploader ?? "";
    doc.description = (meta.description ?? "").slice(0, 5000);
    doc.duration_s = meta.duration ?? doc.duration_s;
    published = publishedAtFromUploadDate(meta.upload_date);
    doc.published_at = published ? published.toISOString() : null;
    doc.chapters = (meta.chapters ?? []).map((c) => ({ title: c.title, t_start: c.start_time, t_end: c.end_time }));
  }

  log("downloading media");
  const src = direct ? await providers.downloadUrl(item.sourceUrl, workDir) : await providers.download(item.sourceUrl, workDir, log);
  const info = await providers.probe(src);
  doc.has_video = info.hasVideo;
  if (!doc.duration_s) doc.duration_s = info.duration;

  log("extracting audio");
  const audioPath = join(workDir, "audio.ogg");
  await providers.extractAudio(src, audioPath);
  await storage.putFile(audioKey(item.id), audioPath);
  if (info.hasVideo) await storage.putFile(rawPrefix(item.id) + basename(src), src);

  await db
    .update(items)
    .set({ title: doc.title, channel: doc.channel, durationS: doc.duration_s, publishedAt: published, updatedAt: new Date() })
    .where(eq(items.id, item.id));
};

const fetchText: StageFn = async (ctx) => {
  const { doc, item, providers, db, log } = ctx;
  doc.has_video = false;
  doc.duration_s = 0;
  const isHttp = /^https?:\/\//i.test(item.sourceUrl);
  if (!doc.body_md.trim()) {
    if (!isHttp) throw new Error("captured text is empty");
    if (isSocialUrl(item.sourceUrl)) throw new Error("social posts are captured from their text (share the post text along with the link)");
    log("fetching page text");
    const page = await providers.fetchPage(item.sourceUrl);
    if (page.body_md.trim().length < 80) throw new Error("couldn't extract readable text from that page — capture the text itself");
    doc.body_md = page.body_md;
    doc.title = doc.title || page.title;
    doc.author = doc.author || page.author;
    doc.channel = doc.channel || page.site_name;
    doc.description = doc.description || page.description;
    doc.published_at = doc.published_at ?? page.published_at;
    doc.linked_videos = extractYouTubeUrls(page.body_md, page.links);
  } else if (!doc.linked_videos.length) {
    doc.linked_videos = extractYouTubeUrls(doc.body_md);
  }
  if (!doc.title) doc.title = doc.body_md.split("\n").map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean)?.slice(0, 120) ?? item.sourceUrl;
  log(`${doc.body_md.length} chars of text${doc.linked_videos.length ? `, ${doc.linked_videos.length} linked video(s)` : ""}`);
  await db
    .update(items)
    .set({ title: doc.title, channel: doc.channel, durationS: 0, publishedAt: doc.published_at ? new Date(doc.published_at) : null, updatedAt: new Date() })
    .where(eq(items.id, item.id));
};
