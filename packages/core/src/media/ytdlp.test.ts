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

import { explainYtdlpError, ytdlpArgs } from "./ytdlp.ts";

describe("yt-dlp on a flagged host", () => {
  it("passes cookies, proxy and extra args through to every call", () => {
    expect(ytdlpArgs({ YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_EXTRA_ARGS: undefined }, null)).toEqual([]);
    expect(ytdlpArgs({ YTDLP_COOKIES: "/secrets/youtube-cookies.txt", YTDLP_PROXY: "http://proxy:3128", YTDLP_EXTRA_ARGS: " --extractor-args youtube:player_client=tv " }, null)).toEqual([
      "--cookies", "/secrets/youtube-cookies.txt", "--proxy", "http://proxy:3128", "--extractor-args", "youtube:player_client=tv",
    ]);
    // the JS runtime yt-dlp needs for YouTube's challenge solver: Bun itself, by default
    expect(ytdlpArgs({ YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_EXTRA_ARGS: undefined }, "/usr/local/bin/bun")).toEqual(["--js-runtimes", "bun:/usr/local/bin/bun"]);
  });
  it("turns the bot check and other known refusals into sentences, and leaves the rest alone", () => {
    expect(explainYtdlpError("yt-dlp -J … exited 1: ERROR: [youtube] LaULblUJfxA: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.")).toMatch(/cookies file or a proxy/);
    expect(explainYtdlpError("ERROR: [youtube] x: Private video. Sign in if you've been granted access")).toMatch(/private, removed/);
    expect(explainYtdlpError("ERROR: HTTP Error 429: Too Many Requests")).toMatch(/rate-limiting/);
    expect(explainYtdlpError("ffmpeg exited 1: something odd")).toBe("ffmpeg exited 1: something odd");
  });
});
