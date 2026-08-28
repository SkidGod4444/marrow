import { describe, expect, it } from "vitest";
import { planChunks } from "../../media/ffmpeg.ts";
import { chunkLimits } from "./transcribe.ts";

describe("transcription chunking", () => {
  const maxBytes = 25 * 1024 * 1024;
  it("leaves a short file whole and splits long audio by duration even when it fits the byte cap", () => {
    expect(chunkLimits({ size: 5e6, duration: 500, maxBytes, maxSeconds: 600 })).toBeNull();
    const long = chunkLimits({ size: 20e6, duration: 5400, maxBytes, maxSeconds: 600 });
    expect(long).toEqual({ target: 480, max: 600 });
  });
  it("a 2.6-hour interview becomes ~16 ten-minute pieces, not two 80-minute ones", () => {
    const duration = 9481;
    const limits = chunkLimits({ size: 28.6e6, duration, maxBytes, maxSeconds: 600 })!;
    expect(limits.max).toBe(600);
    const silences = Array.from({ length: 200 }, (_, i) => ({ start: i * 47.3, end: i * 47.3 + 0.6 }));
    const plan = planChunks(duration, silences, limits);
    expect(plan.length).toBeGreaterThanOrEqual(16);
    expect(Math.max(...plan.map((c) => c.end - c.start))).toBeLessThanOrEqual(600);
    expect(plan[0]!.start).toBe(0);
    expect(plan[plan.length - 1]!.end).toBe(duration);
  });
  it("the byte cap still wins for dense audio", () => {
    // 30 MB over 20 minutes: bytes force ~15-minute pieces even though the duration cap would allow 60
    const limits = chunkLimits({ size: 30e6, duration: 1200, maxBytes, maxSeconds: 3600 })!;
    expect(limits.max).toBeLessThan(1200);
    expect(limits.max).toBeGreaterThan(600);
  });
});
