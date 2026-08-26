import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { frames, items, segments } from "../db/index.ts";
import { newId } from "../ids.ts";
import { fakeEmbedding, testEnv } from "../pipeline/testkit.ts";
import { createNamespace } from "./namespaces.ts";
import { search } from "./search.ts";

describe("hybrid search", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  let itemId: string;
  beforeEach(async () => {
    env = await testEnv();
    const ns = await createNamespace(env.db, { name: "t" });
    itemId = newId("vid");
    await env.db.insert(items).values({ id: itemId, namespaceId: ns.id, sourceType: "youtube_video", sourceUrl: "https://www.youtube.com/watch?v=x", title: "T", status: "ready" });
    await env.db.insert(frames).values({ id: "frm_a", itemId, t: 12, s3Key: "frames/x/12.jpg", caption: "Slide: KV cache layout" });
    const rows = [
      { text: "The KV cache stores keys and values for every attention layer.", t: 10, frameIds: ["frm_a"], embed: true, st: "youtube_video" },
      { text: "Paged attention keeps the cache in fixed-size blocks.", t: 40, frameIds: [], embed: true, st: "youtube_video" },
      { text: "Owner note: revisit the cache eviction discussion.", t: null, frameIds: [], embed: false, st: "note" }, // FTS-only (no embedding)
      { text: "Unrelated: sourdough starter hydration ratios.", t: 90, frameIds: [], embed: true, st: "youtube_video" },
    ];
    await env.db.insert(segments).values(
      rows.map((r, i) => ({ id: newId("seg"), itemId, namespaceId: ns.id, sourceType: r.st, position: i, tStart: r.t, tEnd: r.t === null ? null : r.t + 10, text: r.text, frameIds: r.frameIds, embedding: r.embed ? fakeEmbedding(r.text) : null })),
    );
  });
  afterEach(async () => {
    await env.close();
  });

  it("merges vector and FTS legs with RRF and attaches deep links + frame captions", async () => {
    const { hits } = await search({ db: env.db, config: env.config, embedQuery: async (q) => fakeEmbedding(q) }, { namespace: "t", query: "KV cache", k: 4 });
    expect(hits[0]!.text).toMatch(/^The KV cache/);
    expect(hits[0]!.deep_link).toBe("https://www.youtube.com/watch?v=x&t=10s");
    expect(hits[0]!.frame_captions).toEqual(["Slide: KV cache layout"]);
    expect(hits[0]!.vector_rank).toBe(1);
    expect(hits[0]!.fts_rank).toBe(1);
    expect(hits.find((h) => h.source_type === "note")).toBeUndefined(); // FTS ANDs terms: the note lacks "kv"
    expect(hits.find((h) => /sourdough/.test(h.text))?.fts_rank ?? null).toBeNull();

    // A query the note matches on both terms: it is reachable through FTS alone (no embedding),
    // while the vector leg still surfaces embedded segments that share "cache".
    const r2 = await search({ db: env.db, config: env.config, embedQuery: async (q) => fakeEmbedding(q) }, { namespace: "t", query: "cache eviction", k: 4 });
    const note = r2.hits.find((h) => h.source_type === "note");
    expect(note).toBeDefined();
    expect(note!.vector_rank).toBeNull();
    expect(note!.fts_rank).toBe(1);
    expect(note!.t_start).toBeNull();
    expect(note!.deep_link).toBe("https://www.youtube.com/watch?v=x");
    const kv = r2.hits.find((h) => h.text.startsWith("The KV cache"));
    expect(kv).toBeDefined();
    expect(kv!.fts_rank).toBeNull();
    expect(kv!.vector_rank).not.toBeNull();
  });

  it("honours the source_type filter and k", async () => {
    const notes = await search({ db: env.db, config: env.config, embedQuery: async (q) => fakeEmbedding(q) }, { namespace: "t", query: "cache", k: 8, sourceType: "note" });
    expect(notes.hits.map((h) => h.source_type)).toEqual(["note"]);
    const one = await search({ db: env.db, config: env.config, embedQuery: async (q) => fakeEmbedding(q) }, { namespace: "t", query: "cache", k: 1 });
    expect(one.hits.length).toBe(1);
  });

  it("uses the LLM reranker when configured", async () => {
    const config = { ...env.config, SEARCH_RERANK: "llm" as const };
    const { hits } = await search(
      { db: env.db, config, embedQuery: async (q) => fakeEmbedding(q), rerank: async (_q, cands) => cands.toReversed().map((c) => c.id) },
      { namespace: "t", query: "cache", k: 2 },
    );
    expect(hits.length).toBe(2);
    expect(hits[0]!.text).not.toMatch(/^The KV cache/);
  });
});
