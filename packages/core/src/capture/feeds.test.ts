import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { items } from "../db/index.ts";
import { fakePage, testEnv } from "../pipeline/testkit.ts";
import { InProcessQueue } from "../queue.ts";
import { createNamespace } from "../services/namespaces.ts";
import { addSource, pollSource } from "../services/sources.ts";
import { isMediaEnclosure, parseFeed } from "./feeds.ts";

const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Robot Talk</title><link>https://robottalk.example.com</link>
<item><title>Ep 3: Backlash</title><link>https://robottalk.example.com/ep3</link><guid>ep3</guid><pubDate>Mon, 02 Mar 2026 10:00:00 GMT</pubDate><itunes:author>Robot Talk</itunes:author>
  <enclosure url="https://cdn.example.com/ep3.mp3?x=1" type="audio/mpeg" length="1"/><description>About backlash.</description></item>
<item><title>Ep 2</title><link>https://robottalk.example.com/ep2</link><guid>ep2</guid><enclosure url="https://cdn.example.com/ep2.mp3" type="audio/mpeg"/></item>
<item><title>Ep 1</title><link>https://robottalk.example.com/ep1</link><guid>ep1</guid><enclosure url="https://cdn.example.com/ep1.mp3" type="audio/mpeg"/></item>
<item><title>Show notes post</title><link>https://robottalk.example.com/posts/notes</link><guid>notes</guid><content:encoded><![CDATA[<h2>Notes</h2>${"<p>Long show notes about domain randomization and actuator backlash compensation.</p>".repeat(8)}]]></content:encoded></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><link href="https://blog.example.com"/>
<entry><title>Post A</title><id>tag:a</id><link rel="alternate" href="https://blog.example.com/a"/><published>2026-03-03T00:00:00Z</published><author><name>Ada</name></author><summary>short</summary></entry>
<entry><title>Post B</title><id>tag:b</id><link href="https://blog.example.com/b"/><content type="html">&lt;p&gt;full&lt;/p&gt;</content></entry>
</feed>`;

describe("feeds (PRD §7)", () => {
  it("parses RSS with enclosures and Atom", () => {
    const rss = parseFeed(RSS);
    expect(rss.title).toBe("Robot Talk");
    expect(rss.entries).toHaveLength(4);
    expect(rss.entries[0]).toMatchObject({ title: "Ep 3: Backlash", url: "https://robottalk.example.com/ep3", published_at: "2026-03-02T10:00:00.000Z", author: "Robot Talk" });
    expect(rss.entries[0]?.enclosure).toEqual({ url: "https://cdn.example.com/ep3.mp3?x=1", type: "audio/mpeg" });
    expect(isMediaEnclosure(rss.entries[0]!)).toBe(true);
    expect(isMediaEnclosure(rss.entries[3]!)).toBe(false);
    expect(rss.entries[3]?.content_html).toContain("<h2>Notes</h2>");
    const atom = parseFeed(ATOM);
    expect(atom.title).toBe("Blog");
    expect(atom.entries[0]).toMatchObject({ title: "Post A", url: "https://blog.example.com/a", author: "Ada", published_at: "2026-03-03T00:00:00.000Z" });
    expect(atom.entries[1]?.content_html).toBe("<p>full</p>");
    expect(() => parseFeed("<html></html>")).toThrow(/RSS or Atom/);
  });

  describe("polling a feed", () => {
    let env: Awaited<ReturnType<typeof testEnv>>;
    const queued: string[] = [];
    const queue = new InProcessQueue();
    beforeEach(async () => {
      env = await testEnv();
      await createNamespace(env.db, { name: "pods" });
      queued.length = 0;
      await queue.start(async (id) => {
        queued.push(id);
      });
    });
    afterEach(async () => {
      await queue.stop();
      await env.close();
    });

    it("ingests podcast enclosures through the media pipeline and blog entries as captures, capped per poll", async () => {
      const { source } = await addSource(env.db, { namespace: "pods", url: "https://robottalk.example.com/feed.xml" });
      expect(source.kind).toBe("rss");
      const deps = { db: env.db, queue, storage: env.storage, listEntries: env.listEntries, fetchFeed: async () => parseFeed(RSS), fetchPage: async (u: string) => fakePage(u), maxPerPoll: 2 };
      const first = await pollSource(deps, source);
      expect(first.error).toBeNull();
      expect(first.found).toBe(4);
      expect(first.queued).toHaveLength(2);
      const rows = await env.db.select().from(items).where(eq(items.namespaceId, source.namespaceId));
      expect(rows.map((r) => [r.sourceType, r.title, r.channel])).toEqual([
        ["podcast_episode", "Ep 3: Backlash", "Robot Talk"],
        ["podcast_episode", "Ep 2", "Robot Talk"],
      ]);
      expect(rows[0]?.publishedAt?.toISOString()).toBe("2026-03-02T10:00:00.000Z");

      const second = await pollSource(deps, source);
      expect(second.queued).toHaveLength(2);
      const all = await env.db.select().from(items).where(eq(items.namespaceId, source.namespaceId));
      expect(all).toHaveLength(4);
      const notes = all.find((r) => r.sourceType === "captured_post");
      expect(notes?.title).toBe("Show notes post");
      expect(notes?.sourceUrl).toBe("https://robottalk.example.com/posts/notes");

      const third = await pollSource(deps, source);
      expect(third.queued).toHaveLength(0);
      expect(queued).toHaveLength(4);
    });
  });
});
