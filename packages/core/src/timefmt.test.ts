import { describe, expect, it } from "vitest";
import { deepLink, fmtTs } from "./timefmt.ts";

describe("fmtTs", () => {
  it("formats MM:SS and H:MM:SS", () => {
    expect(fmtTs(0)).toBe("00:00");
    expect(fmtTs(65.9)).toBe("01:05");
    expect(fmtTs(3723)).toBe("1:02:03");
  });
});

describe("deepLink", () => {
  it("adds &t=Ns to YouTube URLs", () => {
    expect(deepLink("https://www.youtube.com/watch?v=abc", 1423.7)).toBe("https://www.youtube.com/watch?v=abc&t=1423s");
    expect(deepLink("https://youtu.be/abc", 5)).toBe("https://youtu.be/abc?t=5s");
  });
  it("leaves untimed sources alone", () => {
    expect(deepLink("https://example.com/post", null)).toBe("https://example.com/post");
  });
});
