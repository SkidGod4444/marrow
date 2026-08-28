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

import { readFile, stat } from "node:fs/promises";
import { explainYtdlpError, makeGate, privateCookies, withBotCheckRetry, ytdlpArgs } from "./ytdlp.ts";

describe("yt-dlp on a flagged host", () => {
  it("passes cookies, proxy and extra args through to every call", () => {
    expect(ytdlpArgs({ YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_EXTRA_ARGS: undefined }, null)).toEqual([]);
    expect(ytdlpArgs({ YTDLP_COOKIES: "/secrets/youtube-cookies.txt", YTDLP_PROXY: "http://proxy:3128", YTDLP_EXTRA_ARGS: " --extractor-args youtube:player_client=tv " }, null)).toEqual([
      "--cookies", "/secrets/youtube-cookies.txt", "--proxy", "http://proxy:3128", "--extractor-args", "youtube:player_client=tv",
    ]);
    // the JS runtime yt-dlp needs for YouTube's challenge solver: Bun itself, by default
    expect(ytdlpArgs({ YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_EXTRA_ARGS: undefined }, "/usr/local/bin/bun")).toEqual(["--js-runtimes", "bun:/usr/local/bin/bun"]);
    // a PO-token provider is pointed at through the bgutil plugin's extractor arg
    expect(ytdlpArgs({ YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_EXTRA_ARGS: undefined, YTDLP_POT_PROVIDER_URL: "http://pot-provider:4416/" }, null)).toEqual(["--extractor-args", "youtubepot-bgutilhttp:base_url=http://pot-provider:4416"]);
  });
  it("turns the bot check and other known refusals into sentences, and leaves the rest alone", () => {
    expect(explainYtdlpError("yt-dlp -J … exited 1: ERROR: [youtube] LaULblUJfxA: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.")).toMatch(/cookies file or a proxy/);
    expect(explainYtdlpError("ERROR: [youtube] x: Private video. Sign in if you've been granted access")).toMatch(/private, removed/);
    expect(explainYtdlpError("ERROR: HTTP Error 429: Too Many Requests")).toMatch(/rate-limiting/);
    expect(explainYtdlpError("ffmpeg exited 1: something odd")).toBe("ffmpeg exited 1: something odd");
    // with cookies configured the advice is different: it is the intermittent check, not a missing file
    expect(explainYtdlpError("ERROR: [youtube] x: Sign in to confirm you’re not a bot.", { hasCookies: true })).toMatch(/rejected this server's session just now/);
  });

  it("gives every run a private copy of the cookies and never touches the owner's file", async () => {
    const dir = await import("node:fs/promises").then((fs) => fs.mkdtemp("/tmp/marrow-jar-"));
    const file = `${dir}/cookies.txt`;
    await import("node:fs/promises").then((fs) => fs.writeFile(file, "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tabc\n"));
    const jar = await privateCookies({ YTDLP_COOKIES: file, YTDLP_PROXY: undefined, YTDLP_EXTRA_ARGS: undefined, YTDLP_POT_PROVIDER_URL: undefined });
    expect(jar.path).not.toBe(file);
    expect(await readFile(jar.path!, "utf8")).toContain("SID\tabc");
    expect(ytdlpArgs({ YTDLP_COOKIES: file, YTDLP_PROXY: undefined, YTDLP_EXTRA_ARGS: undefined, YTDLP_POT_PROVIDER_URL: undefined }, null, jar.path)).toEqual(["--cookies", jar.path]);
    await jar.cleanup();
    await expect(stat(jar.path!)).rejects.toThrow();
    expect((await stat(file)).size).toBeGreaterThan(0); // untouched
    expect((await privateCookies({ YTDLP_COOKIES: undefined, YTDLP_PROXY: undefined, YTDLP_EXTRA_ARGS: undefined, YTDLP_POT_PROVIDER_URL: undefined })).path).toBeNull();
  });

  it("runs YouTube calls one at a time with a gap between them", async () => {
    let t = 0;
    const waits: number[] = [];
    const gate = makeGate(8_000, async (ms) => void (waits.push(ms), (t += ms)), () => t);
    const order: string[] = [];
    const run = (name: string, took: number) =>
      gate(async () => {
        order.push(`${name}:start`);
        t += took;
        order.push(`${name}:end`);
        return name;
      });
    const results = await Promise.all([run("a", 1000), run("b", 1000), run("c", 1000)]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end", "c:start", "c:end"]); // never interleaved
    expect(waits).toEqual([8_000, 8_000]); // the gap after each finished call
  });

  it("retries the intermittent bot check a couple of times, other errors not at all", async () => {
    let n = 0;
    const flaky = async () => {
      n++;
      if (n < 3) throw new Error("ERROR: [youtube] x: Sign in to confirm you’re not a bot.");
      return "ok";
    };
    const waits: number[] = [];
    expect(await withBotCheckRetry(flaky, { attempts: 3, sleep: async (ms) => void waits.push(ms) })).toBe("ok");
    expect([n, waits]).toEqual([3, [240_000, 240_000]]);
    n = 0;
    await expect(withBotCheckRetry(flaky, { attempts: 2, sleep: async () => undefined })).rejects.toThrow(/not a bot/);
    expect(n).toBe(2);
    let m = 0;
    await expect(
      withBotCheckRetry(
        async () => {
          m++;
          throw new Error("HTTP Error 429");
        },
        { sleep: async () => undefined },
      ),
    ).rejects.toThrow(/429/);
    expect(m).toBe(1);
  });
});
