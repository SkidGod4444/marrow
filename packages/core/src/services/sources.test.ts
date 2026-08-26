import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { items, sources } from "../db/index.ts";
import { channelVideosUrl } from "../media/ytdlp.ts";
import { fakeListing, testEnv } from "../pipeline/testkit.ts";
import { InProcessQueue } from "../queue.ts";
import { createNamespace } from "./namespaces.ts";
import { addSource, inferSourceKind, normalizeSourceUrl, pollAllSources, pollSource } from "./sources.ts";

describe("subscriptions (PRD §6.4)", () => {
  it("infers and normalises playlist / channel / rss urls", () => {
    expect(inferSourceKind("https://www.youtube.com/playlist?list=PL123")).toBe("playlist");
    expect(inferSourceKind("https://youtube.com/watch?v=x&list=PL123")).toBe("playlist");
    expect(inferSourceKind("https://www.youtube.com/@karpathy")).toBe("channel");
    expect(inferSourceKind("https://www.youtube.com/channel/UCabc/videos")).toBe("channel");
    expect(inferSourceKind("https://example.com/feed.xml")).toBe("rss");
    expect(() => inferSourceKind("https://www.youtube.com/watch?v=x")).toThrow(/playlist/);
    expect(normalizeSourceUrl("https://youtube.com/watch?v=x&list=PL123&index=3", "playlist")).toBe("https://www.youtube.com/playlist?list=PL123");
    expect(normalizeSourceUrl("https://www.youtube.com/@karpathy/videos", "channel")).toBe("https://www.youtube.com/@karpathy");
    expect(channelVideosUrl("https://www.youtube.com/@karpathy")).toBe("https://www.youtube.com/@karpathy/videos");
    expect(channelVideosUrl("https://www.youtube.com/playlist?list=PL1")).toBe("https://www.youtube.com/playlist?list=PL1");
  });

  describe("polling", () => {
    let env: Awaited<ReturnType<typeof testEnv>>;
    beforeEach(async () => {
      env = await testEnv();
      await createNamespace(env.db, { name: "feeds" });
    });
    afterEach(async () => {
      await env.close();
    });

    it("adds a source once, ingests only unseen uploads, and records last_checked_at", async () => {
      const a = await addSource(env.db, { namespace: "feeds", url: "https://www.youtube.com/playlist?list=PLabc" });
      expect(a.created).toBe(true);
      expect(a.source.kind).toBe("playlist");
      const again = await addSource(env.db, { namespace: "feeds", url: "https://youtube.com/watch?v=zzz&list=PLabc" });
      expect(again.created).toBe(false);
      expect(again.source.id).toBe(a.source.id);

      const queued: string[] = [];
      const queue = new InProcessQueue();
      await queue.start(async (id) => {
        queued.push(id);
      });
      const first = await pollSource({ db: env.db, queue, listEntries: fakeListing }, a.source);
      await queue.stop();
      expect(first.found).toBe(3);
      expect(first.queued).toHaveLength(3);
      expect(first.error).toBeNull();
      expect(queued).toHaveLength(3);
      expect((await env.db.select().from(items)).map((i) => i.status)).toEqual(["queued", "queued", "queued"]);

      const [src] = await env.db.select().from(sources);
      expect(src!.lastCheckedAt).not.toBeNull();
      expect(src!.title).toMatch(/^Playlist /);

      const second = await pollAllSources({ db: env.db, queue, listEntries: fakeListing }, src!.namespaceId);
      expect(second[0]!.found).toBe(3);
      expect(second[0]!.queued).toHaveLength(0);
    });

    it("records errors without throwing", async () => {
      const r = await addSource(env.db, { namespace: "feeds", url: "https://example.com/feed.xml" });
      const res = await pollSource({ db: env.db, listEntries: fakeListing }, r.source);
      expect(res.error).toMatch(/Phase 5/);
      const [src] = await env.db.select().from(sources);
      expect(src!.lastError).toMatch(/Phase 5/);
    });
  });
});
