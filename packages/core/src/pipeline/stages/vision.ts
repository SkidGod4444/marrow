import { eq } from "drizzle-orm";
import { frames } from "../../db/index.ts";
import { pMap } from "../../util.ts";
import type { StageFn } from "../types.ts";

/** Stage 5 — one-sentence caption + OCR per keyframe via the cheap VLM. */
export const visionStage: StageFn = async (ctx) => {
  const { doc, providers, storage, config, usage, log } = ctx;
  if (!doc.frames.length) return { skipped: "no frames" };
  const todo = doc.frames.filter((f) => f.caption === undefined);
  let done = 0;
  await pMap(
    todo,
    async (f) => {
      const jpeg = await storage.get(f.s3_key);
      const d = await providers.describeFrame(jpeg, usage);
      f.caption = d.caption;
      f.ocr_text = d.ocr_text;
      await ctx.db.update(frames).set({ caption: d.caption, ocrText: d.ocr_text }).where(eq(frames.id, f.id));
      done++;
      if (done % 20 === 0 || done === todo.length) log(`${done}/${todo.length} frames described`);
    },
    config.VISION_CONCURRENCY,
  );
};
