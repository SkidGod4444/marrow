import { describe, expect, it } from "vitest";
import { buildSegments, paragraphsToEntries } from "./segmenter.ts";

const sentence = (i: number, len = 120) => `Sentence number ${i} ${"lorem ipsum ".repeat(Math.ceil(len / 12))}.`.slice(0, len - 1) + ".";

describe("buildSegments", () => {
  it("packs entries to ~target chars and splits on sentence ends", () => {
    const entries = Array.from({ length: 40 }, (_, i) => ({ t_start: i * 5, t_end: i * 5 + 5, text: sentence(i) }));
    const segs = buildSegments(entries, { targetChars: 600, maxChars: 900 });
    expect(segs.length).toBeGreaterThan(3);
    for (const s of segs) {
      expect(s.text.length).toBeLessThanOrEqual(900 + 10);
      expect(s.t_start).not.toBeNull();
      expect(s.t_end!).toBeGreaterThan(s.t_start!);
    }
    // Every word survives, in order.
    expect(segs.map((s) => s.text).join(" ")).toBe(entries.map((e) => e.text).join(" "));
    // Sizes hover near target, never way below (except the tail).
    for (const s of segs.slice(0, -1)) expect(s.text.length).toBeGreaterThanOrEqual(600 - 130);
  });

  it("never crosses a chapter boundary", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({ t_start: i * 10, t_end: i * 10 + 10, text: `short ${i}` }));
    const segs = buildSegments(entries, { chapters: [{ title: "a", t_start: 0, t_end: 100 }, { title: "b", t_start: 100, t_end: 200 }], targetChars: 5000, maxChars: 8000 });
    expect(segs).toHaveLength(2);
    expect(segs[0]!.t_end).toBe(100);
    expect(segs[1]!.t_start).toBe(100);
  });

  it("attaches frames whose timestamp falls inside the span", () => {
    const entries = [
      { t_start: 0, t_end: 30, text: "a." },
      { t_start: 30, t_end: 60, text: "b." },
    ];
    const frames = [
      { id: "f1", t: 10, s3_key: "k1" },
      { id: "f2", t: 45, s3_key: "k2" },
      { id: "f3", t: 61, s3_key: "k3" },
    ];
    const segs = buildSegments(entries, { frames, targetChars: 1, maxChars: 10 });
    expect(segs[0]!.frame_ids).toEqual(["f1"]);
    expect(segs[1]!.frame_ids).toEqual(["f2"]);
  });

  it("handles untimed text sources", () => {
    const segs = buildSegments(paragraphsToEntries("para one.\n\npara two.\n\n\npara three."), { targetChars: 15, maxChars: 40 });
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs.every((s) => s.t_start === null)).toBe(true);
  });
});
