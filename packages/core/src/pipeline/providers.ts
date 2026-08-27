import type { Config } from "../config.ts";
import { fetchPage } from "../capture/page.ts";
import { downloadUrl } from "../media/download.ts";
import * as ffmpeg from "../media/ffmpeg.ts";
import * as ytdlp from "../media/ytdlp.ts";
import { embedTexts } from "../openai/embed.ts";
import { generateStructured } from "../openai/text.ts";
import { diarizeFile } from "../openai/diarize.ts";
import { transcribeFile } from "../openai/transcribe.ts";
import { describeFrame } from "../openai/vision.ts";
import type { Providers } from "./types.ts";

export function createProviders(cfg: Config): Providers {
  return {
    fetchMetadata: (url) => ytdlp.fetchMetadata(cfg, url),
    download: (url, outDir) => ytdlp.download(cfg, url, outDir),
    probe: (path) => ffmpeg.probe(cfg, path),
    extractAudio: (src, out) => ffmpeg.extractAudio(cfg, src, out),
    detectSilences: (path) => ffmpeg.detectSilences(cfg, path),
    cutAudio: (src, start, end, out) => ffmpeg.cutAudio(cfg, src, start, end, out),
    extractKeyframes: (video, outDir) => ffmpeg.extractKeyframes(cfg, video, outDir),
    extractEvenFrames: (video, outDir, everyS) => ffmpeg.extractEvenFrames(cfg, video, outDir, everyS),
    transcribe: (path, usage) => transcribeFile(cfg, path, usage),
    diarize: (path, opts, usage) => diarizeFile(cfg, path, opts, usage),
    describeFrame: (jpeg, usage) => describeFrame(cfg, jpeg, usage),
    generate: (opts, usage) => generateStructured(cfg, opts, usage),
    embed: (texts, usage) => embedTexts(cfg, texts, usage),
    fetchPage: (url) => fetchPage(url, { timeoutMs: cfg.CAPTURE_FETCH_TIMEOUT_MS, maxBytes: cfg.CAPTURE_MAX_BYTES }),
    downloadUrl: (url, outDir) => downloadUrl(url, outDir),
  };
}
