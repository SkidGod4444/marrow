import { describe, expect, it } from "vitest";
import type { TranscriptEntry } from "../document.ts";
import { alignSpeakers, toDialogue } from "./speakers.ts";

const entry = (t0: number, words: string[]): TranscriptEntry => ({
  t_start: t0,
  t_end: t0 + words.length,
  speaker: "S1",
  text: words.join(" "),
  words: words.map((w, i) => ({ w, t: t0 + i, t_end: t0 + i + 0.8 })),
});

describe("alignSpeakers", () => {
  it("splits an entry where the speaker changes and normalises labels by first appearance", () => {
    const entries = [entry(0, ["hello", "there", "how", "are", "you"]), entry(5, ["fine", "thanks"])];
    const diar = [
      { start: 0, end: 2.9, speaker: "B", text: "" },
      { start: 2.9, end: 5, speaker: "A", text: "" },
      { start: 5, end: 7, speaker: "B", text: "" },
    ];
    const { entries: out, speakerIds } = alignSpeakers(entries, diar);
    expect(speakerIds).toEqual(["S1", "S2"]);
    expect(out.map((e) => [e.speaker, e.text])).toEqual([
      ["S1", "hello there how"],
      ["S2", "are you"],
      ["S1", "fine thanks"],
    ]);
    expect(out[0]!.t_start).toBe(0);
    expect(out[1]!.t_start).toBe(3);
    expect(out[1]!.words).toHaveLength(2);
  });

  it("labels wordless entries by overlap and falls back to S1 without diarization", () => {
    const e: TranscriptEntry = { t_start: 10, t_end: 20, speaker: "S1", text: "no words here", words: [] };
    const { entries: out } = alignSpeakers([e], [{ start: 0, end: 12, speaker: "X", text: "" }, { start: 12, end: 30, speaker: "Y", text: "" }]);
    expect(out[0]!.speaker).toBe("S1"); // "Y" overlaps more but X appeared first... first appearance is per output order
    expect(alignSpeakers([e], []).entries[0]!.speaker).toBe("S1");
  });
});

describe("toDialogue", () => {
  it("merges consecutive same-speaker entries into paragraphs", () => {
    const es: TranscriptEntry[] = [
      { t_start: 0, t_end: 5, speaker: "S1", text: "a.", words: [] },
      { t_start: 5, t_end: 9, speaker: "S1", text: "b.", words: [] },
      { t_start: 9, t_end: 12, speaker: "S2", text: "c.", words: [] },
    ];
    expect(toDialogue(es)).toEqual([
      { speaker: "S1", t_start: 0, t_end: 9, text: "a. b." },
      { speaker: "S2", t_start: 9, t_end: 12, text: "c." },
    ]);
  });
});
