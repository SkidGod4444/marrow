import { describe, expect, it } from "vitest";
import { fmtTs, linkifyTimestamps, parseTs } from "./time";

describe("timestamps", () => {
  it("formats and parses", () => {
    expect(fmtTs(754)).toBe("12:34");
    expect(fmtTs(3723)).toBe("1:02:03");
    expect(parseTs("12:34")).toBe(754);
    expect(parseTs("1:02:03")).toBe(3723);
    expect(parseTs("nope")).toBeNull();
  });

  it("links [MM:SS] and @ MM:SS citations to #t= anchors the player intercepts", () => {
    expect(linkifyTimestamps("The speaker says so [12:34] and again at [1:02:03].")).toBe("The speaker says so [12:34](#t=754) and again at [1:02:03](#t=3723).");
    expect(linkifyTimestamps("Talk title @ 05:00 covers it")).toBe("Talk title [05:00](#t=300) covers it");
    expect(linkifyTimestamps("already [12:34](#t=754) linked")).toBe("already [12:34](#t=754) linked");
  });
});
