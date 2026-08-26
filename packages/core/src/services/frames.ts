import { asc, eq, sql } from "drizzle-orm";
import { type Db, type FrameRow, frames, segments } from "../db/index.ts";
import type { Storage } from "../storage/index.ts";

export type FrameImage = { frame: FrameRow; mimeType: "image/jpeg"; data: Uint8Array };

/** PRD §8 `get_frame(segment_id | frame_id)`: the keyframe image. For a segment, the first frame on screen during its span, else the nearest. */
export async function getFrame(deps: { db: Db; storage: Storage }, id: string): Promise<FrameImage | null> {
  let frame: FrameRow | undefined;
  if (id.startsWith("seg_")) {
    const [seg] = await deps.db.select().from(segments).where(eq(segments.id, id));
    if (!seg) return null;
    const first = seg.frameIds[0];
    if (first) [frame] = await deps.db.select().from(frames).where(eq(frames.id, first));
    if (!frame && seg.tStart !== null) {
      [frame] = await deps.db
        .select()
        .from(frames)
        .where(eq(frames.itemId, seg.itemId))
        .orderBy(asc(sql`abs(${frames.t} - ${seg.tStart})`))
        .limit(1);
    }
  } else {
    [frame] = await deps.db.select().from(frames).where(eq(frames.id, id));
  }
  if (!frame) return null;
  if (!(await deps.storage.exists(frame.s3Key))) return null;
  return { frame, mimeType: "image/jpeg", data: await deps.storage.get(frame.s3Key) };
}

export async function listFrames(db: Db, itemId: string): Promise<FrameRow[]> {
  return db.select().from(frames).where(eq(frames.itemId, itemId)).orderBy(asc(frames.t));
}
