import type { z } from "zod";
import type { Config } from "../config.ts";
import type { Db, Item, Job, Namespace } from "../db/index.ts";
import type { StageName, VideoDocument } from "../document.ts";
import type { Keyframe, ProbeInfo, Silence } from "../media/ffmpeg.ts";
import type { YtMeta } from "../media/ytdlp.ts";
import type { UsageTracker } from "../openai/client.ts";
import type { GenerateOpts } from "../openai/text.ts";
import type { DiarSegment, KnownSpeaker } from "../openai/diarize.ts";
import type { SttResult } from "../openai/transcribe.ts";
import type { FrameDescription } from "../openai/vision.ts";
import type { Storage } from "../storage/index.ts";
import type { PageContent } from "../capture/page.ts";

/** Everything a stage touches that costs money or shells out — swapped for fakes in tests. */
export interface Providers {
  fetchMetadata(url: string): Promise<YtMeta>;
  download(url: string, outDir: string): Promise<string>;
  probe(path: string): Promise<ProbeInfo>;
  extractAudio(src: string, out: string): Promise<void>;
  detectSilences(path: string): Promise<Silence[]>;
  cutAudio(src: string, start: number, end: number, out: string): Promise<void>;
  extractKeyframes(video: string, outDir: string): Promise<Keyframe[]>;
  extractEvenFrames(video: string, outDir: string, everyS: number): Promise<Keyframe[]>;
  transcribe(path: string, usage: UsageTracker): Promise<SttResult>;
  diarize(path: string, opts: { known?: KnownSpeaker[]; language?: string | null }, usage: UsageTracker): Promise<DiarSegment[]>;
  describeFrame(jpeg: Uint8Array, usage: UsageTracker): Promise<FrameDescription>;
  generate<T extends z.ZodType>(opts: GenerateOpts<T>, usage: UsageTracker): Promise<z.infer<T>>;
  embed(texts: string[], usage: UsageTracker): Promise<number[][]>;
  /** PRD §7 capture: readable text of a public page/PDF (plain fetch). */
  fetchPage(url: string): Promise<PageContent>;
  /** Direct media URL (podcast enclosure) → local file; returns the path. */
  downloadUrl(url: string, outDir: string): Promise<string>;
}

export interface StageContext {
  db: Db;
  storage: Storage;
  config: Config;
  providers: Providers;
  item: Item;
  namespace: Namespace;
  job: Job;
  doc: VideoDocument;
  workDir: string;
  usage: UsageTracker;
  log: (msg: string) => void;
}

export type StageOutcome = { skipped: string } | void;
export type StageFn = (ctx: StageContext) => Promise<StageOutcome>;
export type StageTable = Record<StageName, StageFn>;
