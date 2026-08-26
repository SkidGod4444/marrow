import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InProcessQueue, fakeProviders, runJob, testEnv } from "@marrow/core";
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
    const app = createApp({ db: env.db, config: env.config, queue });
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
  });

  it("requires the owner API key when MARROW_API_KEY is set", async () => {
    const app = createApp({ db: env.db, config: { ...env.config, MARROW_API_KEY: "secret" }, queue: new InProcessQueue() });
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/namespaces")).status).toBe(401);
    expect((await app.request("/namespaces", { headers: { "x-api-key": "wrong" } })).status).toBe(401);
    expect((await app.request("/namespaces", { headers: { "x-api-key": "secret" } })).status).toBe(200);
    expect((await app.request("/namespaces", { headers: { authorization: "Bearer secret" } })).status).toBe(200);
  });
});
