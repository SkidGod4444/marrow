import { describe, expect, it } from "vitest";
import { estimateIngestSeconds, fmtElapsed, remainingLabel, summarizeSteps } from "./ingest-estimate";

describe("ingest estimate", () => {
  it("scales with media length and is short for text", () => {
    expect(estimateIngestSeconds({ sourceType: "youtube_video", durationS: 3600 })).toBe(588); // ~10 min for an hour
    expect(estimateIngestSeconds({ sourceType: "podcast_episode", durationS: 1200 })).toBe(276);
    expect(estimateIngestSeconds({ sourceType: "youtube_video", durationS: null })).toBe(276); // unknown → 20-min guess
    expect(estimateIngestSeconds({ sourceType: "captured_post" })).toBe(60);
  });
  it("counts done steps, drops skipped ones, finds the running one", () => {
    const steps = [
      { stage: "fetch", state: "done" },
      { stage: "transcribe", state: "running" },
      { stage: "diarize", state: "skipped" },
      { stage: "frames", state: "pending" },
    ] as Parameters<typeof summarizeSteps>[0];
    expect(summarizeSteps(steps)).toMatchObject({ done: 1, total: 3, percent: 33, current: { stage: "transcribe" }, failed: null });
  });
  it("speaks about what is left in plain words", () => {
    expect(remainingLabel(30, 600)).toBe("about 10 min left");
    expect(remainingLabel(570, 600)).toBe("under a minute left");
    expect(remainingLabel(700, 600)).toBe("taking longer than usual — still working");
    expect(fmtElapsed(95)).toBe("1:35");
  });
});
