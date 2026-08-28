import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessQueue, fakeEmbedding, fakeProviders, runJob, testEnv } from "@marrow/core";
import { createApp } from "./app.ts";

const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("REST app (Phase 1 endpoints)", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  beforeEach(async () => {
    env = await testEnv();
  });
  afterEach(async () => {
    await env.close();
  });

  it("creates a namespace, enqueues an ingest, runs it, and reports job status", async () => {
    const providers = fakeProviders();
    const queue = new InProcessQueue();
    await queue.start((jobId) => runJob({ ...env, providers }, jobId).then(() => undefined));
    const app = createApp({ ...env, queue, embedQuery: async (q) => fakeEmbedding(q) });
    expect((await app.request("/health")).status).toBe(200);

    const created = await app.request("/namespaces", json({ name: "kv-cache", description: "KV cache papers" }));
    expect(created.status).toBe(201);

    const bad = await app.request("/namespaces", json({ name: "Bad Name!" }));
    expect(bad.status).toBe(400);

    const ingest = await app.request("/ingest", json({ namespace: "kv-cache", url: "https://youtu.be/abc123" }));
    expect(ingest.status).toBe(202);
    const { job_id, item_id } = (await ingest.json()) as { job_id: string; item_id: string };
    await queue.stop(); // drains the in-process queue

    const status = await app.request(`/jobs/${job_id}`);
    expect(status.status).toBe(200);
    const body = (await status.json()) as { job: { state: string; costUsd: number }; item: { status: string }; progress: { stage: string; state: string }[] };
    expect(body.job.state).toBe("done");
    expect(body.item.status).toBe("ready");
    expect(body.job.costUsd).toBeGreaterThan(0);
    expect(body.progress.find((p) => p.stage === "segment")?.state).toBe("done");

    const items = await app.request("/items?namespace=kv-cache&status=ready");
    expect(((await items.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([item_id]);

    const again = await app.request("/ingest", json({ namespace: "kv-cache", url: "https://www.youtube.com/watch?v=abc123" }));
    expect(again.status).toBe(200);
    expect(((await again.json()) as { reused: boolean }).reused).toBe(true);

    const list = await app.request("/namespaces");
    expect(((await list.json()) as { namespaces: { readyCount: number }[] }).namespaces[0]?.readyCount).toBe(1);

    // Phase 2 REST mirrors of the MCP tools.
    const search = await app.request("/search?namespace=kv-cache&q=domain%20randomization&k=3");
    expect(search.status).toBe(200);
    const hits = ((await search.json()) as { hits: Array<{ segment_id: string; deep_link: string; t_start: number }> }).hits;
    expect(hits.length).toBe(3);
    expect(hits[0]!.deep_link).toMatch(/&t=\d+s$/);

    const ctx = await app.request(`/segments/${hits[0]!.segment_id}/context?window_s=20`);
    expect(((await ctx.json()) as { context: string }).context).toMatch(/^\[\d\d:\d\d\]/);

    const frame = await app.request(`/frames/${hits[0]!.segment_id}`);
    expect(frame.status).toBe(200);
    expect(frame.headers.get("content-type")).toBe("image/jpeg");

    const ent = await app.request("/entities?namespace=kv-cache&name=Domain%20randomization");
    expect(((await ent.json()) as { items: number }).items).toBe(1);
    expect((await app.request("/entities?namespace=kv-cache&name=zzz")).status).toBe(404);

    const doc = await app.request(`/items/${item_id}/document?transcript=none`);
    expect(((await doc.json()) as { transcript: null; article: object }).transcript).toBeNull();

    const md = await app.request(`/items/${item_id}/export.md`);
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toMatch(/^---\ntitle: "Talk: [\s\S]*\n# Talk: /);
    expect((await app.request("/namespaces/kv-cache/export.md")).status).toBe(200);
    expect((((await (await app.request("/namespaces/kv-cache/entities")).json()) as { entities: unknown[] }).entities.length)).toBe(2);
  });

  it("serves MCP over Streamable HTTP at /mcp (stateless JSON-RPC)", async () => {
    const app = createApp({ ...env, queue: new InProcessQueue(), embedQuery: async (q) => fakeEmbedding(q) });
    const rpc = (body: unknown) =>
      app.request("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    expect(init.status).toBe(200);
    const initBody = await init.text();
    expect(initBody).toContain('"name":"marrow"');
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    expect(list.status).toBe(200);
    const listBody = await list.text();
    for (const t of ["search", "get_frame", "lookup_entity", "export_markdown"]) expect(listBody).toContain(`"name":"${t}"`);
  });

  it("requires the owner API key when MARROW_API_KEY is set", async () => {
    const app = createApp({ ...env, config: { ...env.config, MARROW_API_KEY: "secret", MARROW_COMMIT: "abc1234" }, queue: new InProcessQueue(), embedQuery: async (q) => fakeEmbedding(q) });
    expect((await app.request("/health")).status).toBe(200);
    expect(await (await app.request("/health")).json()).toMatchObject({ ok: true, commit: "abc1234", started_at: expect.any(String), queue: { driver: "in-process", queued: 0, running: 0 } });
    expect((await app.request("/namespaces")).status).toBe(401);
    expect((await app.request("/namespaces", { headers: { "x-api-key": "wrong" } })).status).toBe(401);
    expect((await app.request("/namespaces", { headers: { "x-api-key": "secret" } })).status).toBe(200);
    expect((await app.request("/namespaces", { headers: { authorization: "Bearer secret" } })).status).toBe(200);
  });

  it("installs a YouTube cookie jar from the owner's browser and re-probes", async () => {
    const { mkdtemp, readFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "marrow-jar-"));
    const path = join(dir, "cookies.txt");
    let rechecked = 0;
    const app = createApp({
      ...env,
      config: { ...env.config, MARROW_API_KEY: "secret", YTDLP_COOKIES: path },
      queue: new InProcessQueue(),
      embedQuery: async (q) => fakeEmbedding(q),
      health: { storage: () => "ok", youtube: () => "cookies_stale", recheckYoutube: async () => void rechecked++ },
    });
    const far = Math.floor(Date.now() / 1000) + 86_400 * 300;
    const jar = ["SID", "HSID", "SSID", "APISID", "SAPISID"].map((n) => `.youtube.com\tTRUE\t/\tTRUE\t${far}\t${n}\tv`).join("\n");
    const noKey = await app.request("/youtube/cookies", { method: "POST", headers: { "content-type": "text/plain" }, body: jar });
    expect(noKey.status).toBe(401);
    const bad = await app.request("/youtube/cookies", { method: "POST", headers: { "content-type": "text/plain", "x-api-key": "secret" }, body: "nothing here" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/no cookies found/);
    const ok = await app.request("/youtube/cookies", { method: "POST", headers: { "content-type": "application/json", "x-api-key": "secret" }, body: JSON.stringify({ cookies: jar }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, cookies: 5, checking: true });
    expect(rechecked).toBe(1);
    expect((await readFile(path, "utf8")).split("\n").filter((l) => l.includes("\tSID\t"))).toHaveLength(1);
  });
});
