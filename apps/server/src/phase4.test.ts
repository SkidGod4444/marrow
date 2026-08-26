import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessQueue, createIngest, createNamespace, events, fakeProviders, getNamespace, items, runJob, testEnv } from "@marrow/core";
import { createApp } from "./app.ts";

const TOPICS = ["kv cache compression", "sliding window attention", "paged attention memory", "speculative decoding", "quantization int4 kernels", "flash attention tiling"];
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("Phase 4 — inbox, novelty, namespace summary, sources, namespace chat", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  const ids: string[] = [];
  beforeEach(async () => {
    env = await testEnv();
    ids.length = 0;
    await createNamespace(env.db, { name: "inference", description: "LLM inference" });
    const providers = fakeProviders({ durationS: 600 });
    for (const t of TOPICS) {
      const res = await createIngest(env.db, { namespace: "inference", url: `https://www.youtube.com/watch?v=${t.replace(/ /g, "-")}` });
      await runJob({ ...env, providers }, res.job.id);
      ids.push(res.item.id);
    }
  });
  afterEach(async () => {
    await env.close();
  });

  it("runs novelty triage from the 6th item and stores the verdict on the item", async () => {
    const rows = await env.db.select().from(items);
    const sixth = rows.find((r) => r.id === ids[5])!;
    expect(sixth.novelty).not.toBeNull();
    expect(sixth.novelty!.verdict).toMatch(/overlaps existing corpus|new material/);
    expect(sixth.novelty!.sections.length).toBe(3);
    expect(sixth.novelty!.sections[0]!.label).toBe("known");
    expect(sixth.novelty!.sections[0]!.covered_by[0]!.title).toMatch(/^Talk: /);
    expect(sixth.novelty!.overlap_ratio).toBeGreaterThan(0);
    const fifth = rows.find((r) => r.id === ids[4])!;
    expect(fifth.novelty).toBeNull(); // only 4 other items existed then
    expect(rows.every((r) => r.summary)).toBe(true); // denormalised for the inbox
  });

  it("regenerates the namespace summary every 3rd ingest", async () => {
    const ns = (await getNamespace(env.db, "inference"))!;
    expect(ns.summary).toMatch(/^Corpus of 6 items/);
  });

  it("serves the inbox and archives on skip", async () => {
    const app = createApp({ ...env, queue: new InProcessQueue() });
    const inbox = (await (await app.request("/inbox")).json()) as { entries: Array<{ id: string; summary: string; novelty: { verdict: string } | null; namespace: { name: string } }>; pending: unknown[] };
    expect(inbox.entries).toHaveLength(6);
    expect(inbox.entries[0]!.id).toBe(ids[5]); // newest first
    expect(inbox.entries[0]!.novelty?.verdict).toBeTruthy();
    expect(inbox.entries[0]!.summary).toBeTruthy();
    expect(inbox.entries[0]!.namespace.name).toBe("inference");

    const skip = await app.request(`/items/${ids[5]}/archive`, json({}));
    expect(skip.status).toBe(200);
    const after = (await (await app.request("/inbox")).json()) as { entries: Array<{ id: string }> };
    expect(after.entries.map((e) => e.id)).not.toContain(ids[5]);
    expect(((await (await app.request("/inbox?archived=1")).json()) as { entries: unknown[] }).entries).toHaveLength(6);
    const evs = (await env.db.select().from(events)).filter((e) => e.itemId === ids[5]).map((e) => e.kind);
    expect(evs).toContain("skipped");
    await app.request(`/items/${ids[5]}/archive`, json({ archived: false }));
    expect(((await (await app.request("/inbox")).json()) as { entries: unknown[] }).entries).toHaveLength(6);
  });

  it("subscribes to a playlist, polls it, and queues the new uploads", async () => {
    const queue = new InProcessQueue();
    await queue.start(async () => undefined);
    const app = createApp({ ...env, queue });
    const res = await app.request("/sources", json({ namespace: "inference", url: "https://www.youtube.com/playlist?list=PLxyz" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { source: { kind: string }; poll: { found: number; queued: string[] } };
    expect(body.source.kind).toBe("playlist");
    expect(body.poll.found).toBe(3);
    expect(body.poll.queued).toHaveLength(3);
    const list = (await (await app.request("/sources?namespace=inference")).json()) as { sources: Array<{ id: string; lastCheckedAt: string }> };
    expect(list.sources).toHaveLength(1);
    const again = (await (await app.request(`/sources/${list.sources[0]!.id}/poll`, json({}))).json()) as { queued: string[] };
    expect(again.queued).toHaveLength(0);
    const pending = (await (await app.request("/inbox")).json()) as { pending: unknown[] };
    expect(pending.pending).toHaveLength(3);
    expect((await app.request(`/sources/${list.sources[0]!.id}`, { method: "DELETE" })).status).toBe(200);
    await queue.stop();
  });

  it("namespace chat gets the summary + entity index as context and the retrieval tools", async () => {
    let seenSystem = "";
    let seenTools: string[] = [];
    const chatModel = new MockLanguageModelV3({
      doStream: async ({ prompt, tools }) => {
        const sys = prompt.find((m) => m.role === "system");
        seenSystem = typeof sys?.content === "string" ? sys.content : "";
        seenTools = (tools ?? []).map((t) => t.name);
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "Two videos disagree: [Talk: kv cache compression @ 00:10](/items/x?t=10) and [Talk: speculative decoding @ 00:20](/items/y?t=20)." },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined }, raw: undefined } },
            ],
          }),
        };
      },
    });
    const app = createApp({ ...env, queue: new InProcessQueue(), chatModel });
    const res = await app.request("/namespaces/inference/chat", json({ messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Where do the videos disagree?" }] }] }));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Two videos disagree");
    expect(seenSystem).toContain("CORPUS SUMMARY:\nCorpus of 6 items");
    expect(seenSystem).toContain("ENTITY INDEX");
    expect(seenSystem).toContain("Domain randomization (technique");
    expect(seenSystem).toContain(`- ${ids[0]} — Talk: kv cache compression`);
    expect(seenTools.sort()).toEqual(["get_context", "get_video", "lookup_entity", "search", "view_frame"]);
    expect((await app.request("/namespaces/nope/chat", json({ messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "x" }] }] }))).status).toBe(404);
  });
});
