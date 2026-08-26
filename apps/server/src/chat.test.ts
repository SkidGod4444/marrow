import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessQueue, createIngest, createNamespace, events, fakeEmbedding, fakeProviders, runJob, testEnv } from "@marrow/core";
import { createApp } from "./app.ts";

describe("POST /items/:id/chat (Phase 3 per-video chat)", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  let itemId: string;
  beforeEach(async () => {
    env = await testEnv();
    await createNamespace(env.db, { name: "n" });
    const res = await createIngest(env.db, { namespace: "n", url: "https://www.youtube.com/watch?v=kv-cache" });
    await runJob({ ...env, providers: fakeProviders({ durationS: 300 }) }, res.job.id);
    itemId = res.item.id;
  });
  afterEach(async () => {
    await env.close();
  });

  it("streams a UI-message response with the static transcript prefix as the system prompt", async () => {
    let seenSystem = "";
    let seenLastUser = "";
    const chatModel = new MockLanguageModelV3({
      doStream: async ({ prompt }) => {
        const sys = prompt.find((m) => m.role === "system");
        seenSystem = typeof sys?.content === "string" ? sys.content : "";
        const user = prompt.toReversed().find((m) => m.role === "user");
        seenLastUser = JSON.stringify(user?.content ?? "");
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "stream-start", warnings: [] },
              { type: "text-start", id: "t1" },
              { type: "text-delta", id: "t1", delta: "The speaker covers domain randomization [00:10]." },
              { type: "text-end", id: "t1" },
              { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined }, raw: undefined } },
            ],
          }),
        };
      },
    });
    const app = createApp({ ...env, queue: new InProcessQueue(), embedQuery: async (q) => fakeEmbedding(q), chatModel });
    const res = await app.request(`/items/${itemId}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "What is covered?" }] }], playback_t: 42 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = await res.text();
    expect(body).toContain("text-delta");
    expect(body).toContain("domain randomization [00:10]");
    expect(seenSystem).toContain("TRANSCRIPT:");
    expect(seenSystem).toContain("[00:00] ");
    expect(seenSystem).toContain("KEYFRAMES");
    expect(seenLastUser).toContain("Player is at [00:42]");

    const evs = (await env.db.select().from(events)).filter((e) => e.itemId === itemId);
    expect(evs.map((e) => e.kind)).toContain("chatted");
  });

  it("404s for unknown items and logs read events", async () => {
    const app = createApp({ ...env, queue: new InProcessQueue(), embedQuery: async (q) => fakeEmbedding(q) });
    const res = await app.request("/items/vid_nope/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "x" }] }] }) });
    expect(res.status).toBe(404);
    const ev = await app.request(`/items/${itemId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "read" }) });
    expect(ev.status).toBe(200);
    expect((await app.request(`/items/${itemId}/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "bogus" }) })).status).toBe(400);
  });
});
