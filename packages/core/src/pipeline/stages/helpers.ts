import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join } from "node:path";
import { rawPrefix } from "../../document.ts";
import type { StageContext } from "../types.ts";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Use the local copy if the work dir still has it, otherwise pull it from object storage (resume after restart). */
export async function ensureLocal(ctx: StageContext, key: string, localPath: string): Promise<string> {
  if (!existsSync(localPath)) await ctx.storage.getToFile(key, localPath);
  return localPath;
}

/** The downloaded source video: `workDir/source.*` locally, else `raw/{item}/` in storage. */
export async function ensureSource(ctx: StageContext): Promise<string> {
  const files = existsSync(ctx.workDir) ? await readdir(ctx.workDir) : [];
  const local = files.find((f) => f.startsWith("source."));
  if (local) return join(ctx.workDir, local);
  const keys = await ctx.storage.list(rawPrefix(ctx.item.id));
  const key = keys.find((k) => basename(k).startsWith("source."));
  if (!key) throw new Error(`no raw media for ${ctx.item.id}; re-run the fetch stage`);
  const path = join(ctx.workDir, basename(key));
  await ctx.storage.getToFile(key, path);
  return path;
}
