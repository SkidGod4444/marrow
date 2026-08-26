import { mkdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { eq } from "drizzle-orm";
import { items } from "../../db/index.ts";
import { audioKey, rawPrefix } from "../../document.ts";
import { publishedAtFromUploadDate } from "../../media/ytdlp.ts";
import type { StageFn } from "../types.ts";

/** Stage 1 — yt-dlp metadata + media, ffmpeg → mono low-bitrate audio, raw video parked in storage for the frames stage. */
export const fetchStage: StageFn = async (ctx) => {
  const { doc, item, providers, storage, workDir, db, log } = ctx;
  await mkdir(workDir, { recursive: true });

  log("fetching metadata");
  const meta = await providers.fetchMetadata(item.sourceUrl);
  doc.title = meta.title ?? doc.title;
  doc.channel = meta.channel ?? meta.uploader ?? "";
  doc.description = (meta.description ?? "").slice(0, 5000);
  doc.duration_s = meta.duration ?? doc.duration_s;
  const published = publishedAtFromUploadDate(meta.upload_date);
  doc.published_at = published ? published.toISOString() : null;
  doc.chapters = (meta.chapters ?? []).map((c) => ({ title: c.title, t_start: c.start_time, t_end: c.end_time }));

  log("downloading media");
  const src = await providers.download(item.sourceUrl, workDir);
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
