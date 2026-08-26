import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { exec } from "./exec.ts";

export type ProbeInfo = { duration: number; hasVideo: boolean; hasAudio: boolean };

export async function probe(cfg: Config, path: string): Promise<ProbeInfo> {
  const { stdout } = await exec(cfg.FFPROBE_BIN, [
    "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path,
  ]);
  const j = JSON.parse(stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  const types = (j.streams ?? []).map((s) => s.codec_type);
  return {
    duration: Number(j.format?.duration ?? 0),
    hasVideo: types.includes("video"),
    hasAudio: types.includes("audio"),
  };
}

/** Mono 16 kHz Opus @ 24 kbps (voip tuning): ~11 MB/hour, well under whisper-1's 25 MB cap for a 2-hour episode. */
export async function extractAudio(cfg: Config, src: string, out: string): Promise<void> {
  await exec(cfg.FFMPEG_BIN, [
    "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-vn", "-ac", "1", "-ar", "16000",
    "-c:a", "libopus", "-b:a", "24k", "-application", "voip", out,
  ]);
}

export type Silence = { start: number; end: number };

export async function detectSilences(cfg: Config, path: string, opts: { noiseDb?: number; minDur?: number } = {}): Promise<Silence[]> {
  const { stderr } = await exec(cfg.FFMPEG_BIN, [
    "-hide_banner", "-nostats", "-i", path, "-af", `silencedetect=noise=${opts.noiseDb ?? -30}dB:d=${opts.minDur ?? 0.4}`, "-f", "null", "-",
  ]);
  return parseSilences(stderr);
}

export function parseSilences(stderr: string): Silence[] {
  const out: Silence[] = [];
  let start: number | null = null;
  for (const line of stderr.split("\n")) {
    const s = /silence_start:\s*([\d.]+)/.exec(line);
    if (s) start = Number(s[1]);
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && start !== null) {
      out.push({ start, end: Number(e[1]) });
      start = null;
    }
  }
  return out;
}

export type Chunk = { start: number; end: number };

/**
 * Split [0, duration] into chunks of ≈ `target` seconds, never more than `max`, cutting at the silence whose
 * midpoint is closest to the ideal cut. Falls back to a hard cut at `max` when no silence is in range.
 */
export function planChunks(duration: number, silences: Silence[], opts: { target: number; max: number }): Chunk[] {
  const chunks: Chunk[] = [];
  let cursor = 0;
  const mids = silences.map((s) => (s.start + s.end) / 2).sort((a, b) => a - b);
  while (duration - cursor > opts.max) {
    const ideal = cursor + opts.target;
    const lo = cursor + opts.target * 0.5;
    const hi = cursor + opts.max;
    let best: number | null = null;
    for (const m of mids) {
      if (m < lo || m > hi) continue;
      if (best === null || Math.abs(m - ideal) < Math.abs(best - ideal)) best = m;
    }
    const cut = best ?? hi;
    chunks.push({ start: cursor, end: cut });
    cursor = cut;
  }
  chunks.push({ start: cursor, end: duration });
  return chunks;
}

export async function cutAudio(cfg: Config, src: string, start: number, end: number, out: string): Promise<void> {
  await exec(cfg.FFMPEG_BIN, [
    "-y", "-hide_banner", "-loglevel", "error", "-ss", start.toFixed(3), "-i", src, "-t", (end - start).toFixed(3),
    "-ac", "1", "-ar", "16000", "-c:a", "libopus", "-b:a", "24k", "-application", "voip", out,
  ]);
}

/** AAC clip for language mode (plays natively in every browser). */
export async function cutClip(cfg: Config, src: string, start: number, end: number, out: string): Promise<void> {
  await exec(cfg.FFMPEG_BIN, [
    "-y", "-hide_banner", "-loglevel", "error", "-ss", Math.max(0, start - 0.15).toFixed(3), "-i", src,
    "-t", (end - start + 0.3).toFixed(3), "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "64k", out,
  ]);
}

export type Keyframe = { t: number; score: number; path: string };

/**
 * Scene-change keyframes in one decode pass: `select` keeps frames whose scene score exceeds the threshold,
 * `metadata=print` writes `pts_time` + `lavfi.scene_score` to stdout so we can rank and prune afterwards.
 */
export async function extractKeyframes(cfg: Config, video: string, outDir: string): Promise<Keyframe[]> {
  await mkdir(outDir, { recursive: true });
  const vf = `select='gt(scene,${cfg.SCENE_THRESHOLD})',metadata=print:file=-,scale=${cfg.FRAME_WIDTH}:-2`;
  const { stdout } = await exec(cfg.FFMPEG_BIN, [
    // yuvj420p + strict unofficial: some YouTube encodes are full-range YUV, which the mjpeg encoder otherwise rejects.
    "-y", "-hide_banner", "-loglevel", "error", "-i", video, "-vf", vf, "-fps_mode", "vfr", "-q:v", "3", "-pix_fmt", "yuvj420p", "-strict", "unofficial",
    join(outDir, "%05d.jpg"),
  ]);
  return parseKeyframeLog(stdout).map((k, i) => ({ ...k, path: join(outDir, `${String(i + 1).padStart(5, "0")}.jpg`) }));
}

export function parseKeyframeLog(stdout: string): Array<{ t: number; score: number }> {
  const out: Array<{ t: number; score: number }> = [];
  let current: { t: number; score: number } | null = null;
  for (const line of stdout.split("\n")) {
    const f = /pts_time:\s*([\d.]+)/.exec(line);
    if (f) {
      if (current) out.push(current);
      current = { t: Number(f[1]), score: 0 };
      continue;
    }
    const s = /lavfi\.scene_score=([\d.]+)/.exec(line);
    if (s && current) current.score = Number(s[1]);
  }
  if (current) out.push(current);
  return out;
}

/** Keep the highest-scoring frames, at least `minGap` seconds apart, at most `max` of them; returned in time order. */
export function pruneFrames<T extends { t: number; score: number }>(frames: T[], opts: { minGap: number; max: number }): T[] {
  const byScore = [...frames].sort((a, b) => b.score - a.score || a.t - b.t);
  const kept: T[] = [];
  for (const f of byScore) {
    if (kept.length >= opts.max) break;
    if (kept.some((k) => Math.abs(k.t - f.t) < opts.minGap)) continue;
    kept.push(f);
  }
  return kept.sort((a, b) => a.t - b.t);
}

export async function removeFiles(paths: string[]): Promise<void> {
  await Promise.all(paths.map((p) => unlink(p).catch(() => undefined)));
}
