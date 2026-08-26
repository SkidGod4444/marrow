import { describe, expect, it } from "vitest";
import { toEntries } from "./transcribe.ts";

describe("toEntries", () => {
  it("assigns words to segments and offsets timestamps for chunked audio", () => {
    const r = {
      language: "en",
      duration: 10,
      text: "hello world again",
      segments: [
        { start: 0, end: 2, text: " hello world" },
        { start: 2, end: 4, text: " again" },
        { start: 4, end: 5, text: "   " },
      ],
      words: [
        { word: "hello", start: 0.1, end: 0.5 },
        { word: "world", start: 0.6, end: 1.2 },
        { word: "again", start: 2.2, end: 2.8 },
      ],
    };
    const entries = toEntries(r, 600);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ t_start: 600, t_end: 602, text: "hello world", speaker: "S1" });
    expect(entries[0]!.words).toEqual([
      { w: "hello", t: 600.1, t_end: 600.5 },
      { w: "world", t: 600.6, t_end: 601.2 },
    ]);
    expect(entries[1]!.words).toEqual([{ w: "again", t: 602.2, t_end: 602.8 }]);
  });
});
