import { describe, expect, it } from "vitest";
import { parseKeyframeLog, parseSilences, planChunks, pruneFrames } from "./ffmpeg.ts";

describe("planChunks", () => {
  it("returns a single chunk when the audio fits", () => {
    expect(planChunks(100, [], { target: 80, max: 120 })).toEqual([{ start: 0, end: 100 }]);
  });

  it("cuts at the silence nearest the ideal point and never exceeds max", () => {
    const silences = [
      { start: 590, end: 591 },
      { start: 1210, end: 1211.5 },
      { start: 1780, end: 1781 },
    ];
    const chunks = planChunks(2400, silences, { target: 600, max: 900 });
    expect(chunks[0]).toEqual({ start: 0, end: 590.5 });
    expect(chunks[1]!.end).toBe(1210.75);
    expect(chunks[chunks.length - 1]!.end).toBe(2400);
    for (const c of chunks) expect(c.end - c.start).toBeLessThanOrEqual(900);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.start).toBe(chunks[i - 1]!.end);
  });

  it("hard-cuts at max when no silence is in range", () => {
    const chunks = planChunks(1000, [], { target: 300, max: 400 });
    expect(chunks.map((c) => c.end)).toEqual([400, 800, 1000]);
  });
});

describe("parseSilences", () => {
  it("pairs silence_start/silence_end lines", () => {
    const stderr = `[silencedetect @ 0x1] silence_start: 12.5\n[silencedetect @ 0x1] silence_end: 13.2 | silence_duration: 0.7\nsize=N/A\n[silencedetect @ 0x1] silence_start: 40\n[silencedetect @ 0x1] silence_end: 41 | silence_duration: 1`;
    expect(parseSilences(stderr)).toEqual([
      { start: 12.5, end: 13.2 },
      { start: 40, end: 41 },
    ]);
  });
});

describe("parseKeyframeLog", () => {
  it("reads pts_time and scene_score pairs", () => {
    const out = `frame:0    pts:1234  pts_time:4.1166\nlavfi.scene_score=0.512345\nframe:1    pts:9999  pts_time:120.5\nlavfi.scene_score=0.31\n`;
    expect(parseKeyframeLog(out)).toEqual([
      { t: 4.1166, score: 0.512345 },
      { t: 120.5, score: 0.31 },
    ]);
  });
});

describe("pruneFrames", () => {
  it("keeps the best-scoring frames with a minimum gap, capped, in time order", () => {
    const frames = [
      { t: 1, score: 0.9 },
      { t: 2, score: 0.95 }, // within 2s of t=1 → wins over it
      { t: 10, score: 0.4 },
      { t: 20, score: 0.5 },
      { t: 30, score: 0.6 },
    ];
    const kept = pruneFrames(frames, { minGap: 2, max: 3 });
    expect(kept.map((f) => f.t)).toEqual([2, 20, 30]);
  });
});
