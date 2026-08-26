import { rm } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { frames } from "../../db/index.ts";
import { frameKey } from "../../document.ts";
import { newId } from "../../ids.ts";
import { pruneFrames, removeFiles } from "../../media/ffmpeg.ts";
import type { StageFn } from "../types.ts";
import { ensureSource, round2 } from "./helpers.ts";

/** Stage 4 — scene-change keyframes only, capped at FRAMES_PER_HOUR (PRD: ~120/hr); skipped for audio-only sources. */
export const framesStage: StageFn = async (ctx) => {
  const { doc, item, providers, storage, workDir, config, log } = ctx;
  if (!doc.has_video) return { skipped: "audio-only source" };

  const src = await ensureSource(ctx);
  const dir = join(workDir, "frames");
  await rm(dir, { recursive: true, force: true });
  log("detecting scene changes");
  const found = await providers.extractKeyframes(src, dir);
  const cap = Math.max(8, Math.ceil((config.FRAMES_PER_HOUR * Math.max(doc.duration_s, 60)) / 3600));
  const kept = pruneFrames(found, { minGap: config.FRAME_MIN_GAP_S, max: cap });
  log(`${found.length} scene changes → keeping ${kept.length} keyframes (cap ${cap})`);
  await removeFiles(found.filter((f) => !kept.includes(f)).map((f) => f.path));

  doc.frames = [];
  for (const f of kept) {
    const key = frameKey(item.id, f.t);
    await storage.putFile(key, f.path);
    doc.frames.push({ id: newId("frm"), t: round2(f.t), s3_key: key, scene_score: f.score });
  }
  await ctx.db.delete(frames).where(eq(frames.itemId, item.id));
  if (doc.frames.length) {
    await ctx.db.insert(frames).values(doc.frames.map((f) => ({ id: f.id, itemId: item.id, t: f.t, s3Key: f.s3_key, sceneScore: f.scene_score ?? null })));
  }
};
