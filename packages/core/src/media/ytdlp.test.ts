import { describe, expect, it } from "vitest";
import { canonicalizeSourceUrl } from "./ytdlp.ts";

describe("canonicalizeSourceUrl", () => {
  it("normalises YouTube variants to watch?v=", () => {
    const want = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    expect(canonicalizeSourceUrl("https://youtu.be/dQw4w9WgXcQ?si=xyz")).toBe(want);
    expect(canonicalizeSourceUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4&t=30s")).toBe(want);
    expect(canonicalizeSourceUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(want);
    expect(canonicalizeSourceUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe(want);
  });
  it("strips tracking params from other URLs", () => {
    expect(canonicalizeSourceUrl("https://example.com/a?utm_source=x&id=1#frag")).toBe("https://example.com/a?id=1");
  });
});
