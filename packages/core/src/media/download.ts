import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { assertPublicHttpUrl } from "../capture/page.ts";

/** Stream a direct media URL (podcast enclosure) to `outDir/source.<ext>`; the fetch stage probes/transcodes it like a yt-dlp download. */
export async function downloadUrl(url: string, outDir: string, opts: { maxBytes?: number; fetchImpl?: typeof fetch } = {}): Promise<string> {
  assertPublicHttpUrl(url);
  await mkdir(outDir, { recursive: true });
  const res = await (opts.fetchImpl ?? fetch)(url, { redirect: "follow", headers: { "user-agent": "Marrow/0.1 (+podcast fetch)" } });
  if (!res.ok || !res.body) throw new Error(`media URL answered ${res.status}`);
  const max = opts.maxBytes ?? 2 * 1024 * 1024 * 1024;
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) throw new Error("media file is too large");
  const ext = extFor(res.headers.get("content-type") ?? "", res.url || url);
  const path = join(outDir, `source.${ext}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(path));
  return path;
}

function extFor(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("mpeg") || ct.includes("mp3")) return "mp3";
  if (ct.includes("mp4") || ct.includes("m4a") || ct.includes("aac")) return "m4a";
  if (ct.includes("ogg") || ct.includes("opus")) return "ogg";
  if (ct.includes("wav")) return "wav";
  const m = url.match(/\.(mp3|m4a|aac|ogg|opus|wav|mp4|m4v|webm)(\?|$)/i);
  return m ? m[1]!.toLowerCase() : "bin";
}
