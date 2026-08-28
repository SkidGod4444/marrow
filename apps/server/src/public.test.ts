import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessQueue, createIngest, createNamespace, fakeEmbedding, fakeProviders, runJob, testEnv } from "@marrow/core";
import { createApp } from "./app.ts";

// The share pages' API: read-only, ready items only, no key — and nothing else leaks through it.
describe("public share routes", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  let app: ReturnType<typeof createApp>;
  beforeEach(async () => {
    env = await testEnv();
    app = createApp({ ...env, config: { ...env.config, MARROW_API_KEY: "secret" }, queue: new InProcessQueue(), embedQuery: async (q) => fakeEmbedding(q) });
  });
  afterEach(async () => {
    await env.close();
  });

  it("serves a ready item's document, audio, exports and read events without a key; hides everything else", async () => {
    const ns = await createNamespace(env.db, { name: "demo" });
    const r = await createIngest(env.db, { namespace: ns.id, url: "https://cdn.example.com/robot-talk/ep3.mp3", sourceType: "podcast_episode" });
    const queued = await createIngest(env.db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=pending1" });
    // before it is ready: not public
    expect((await app.request(`/public/items/${r.item.id}`)).status).toBe(404);
    await runJob({ ...env, providers: fakeProviders() }, r.job.id);

    const res = await app.request(`/public/items/${r.item.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("public");
    const body = (await res.json()) as { item: { id: string; status: string }; document: { title: string; transcript: unknown[] | null; article: unknown } };
    expect(body.item).toMatchObject({ id: r.item.id, status: "ready" });
    expect(body.document.transcript?.length).toBeGreaterThan(0);

    expect((await app.request(`/public/items/${r.item.id}/audio`)).status).toBe(200);
    expect((await app.request(`/public/items/${r.item.id}/audio`, { headers: { range: "bytes=0-10" } })).status).toBe(206);
    expect((await app.request(`/public/items/${r.item.id}/export.md`)).status).toBe(200);
    expect((await app.request(`/public/items/${r.item.id}/export.txt`)).status).toBe(200);
    expect((await app.request(`/public/items/${r.item.id}/events`, { method: "POST" })).status).toBe(200);

    const list = (await (await app.request("/public/items")).json()) as { items: Array<{ id: string }> };
    expect(list.items.map((i) => i.id)).toEqual([r.item.id]); // the queued one is not listed

    // the queued item stays private, and the signed-in routes still need a key
    expect((await app.request(`/public/items/${queued.item.id}`)).status).toBe(404);
    expect((await app.request(`/public/items/${queued.item.id}/audio`)).status).toBe(404);
    expect((await app.request(`/items/${r.item.id}`)).status).toBe(401);
    expect((await app.request("/public/items/vid_nope")).status).toBe(404);
  });
});
