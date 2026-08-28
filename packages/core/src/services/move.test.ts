import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { entities, mentions, segments } from "../db/index.ts";
import { loadDocument, runJob } from "../pipeline/runner.ts";
import { fakeProviders, testEnv } from "../pipeline/testkit.ts";
import { createIngest } from "./ingest.ts";
import { moveItem } from "./move.ts";
import { createNamespace } from "./namespaces.ts";

describe("moving an item between namespaces", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  beforeEach(async () => {
    env = await testEnv();
  });
  afterEach(async () => {
    await env.close();
  });

  it("carries the search index and entity mentions along, prunes the old namespace's orphans, and re-runs what the namespace decides", async () => {
    const a = await createNamespace(env.db, { name: "robotics" });
    const b = await createNamespace(env.db, { name: "english", flags: { language_learning: true } });
    const providers = fakeProviders();
    const r = await createIngest(env.db, { namespace: a.id, url: "https://www.youtube.com/watch?v=move1" });
    await runJob({ ...env, providers }, r.job.id);
    expect((await env.db.select().from(entities).where(eq(entities.namespaceId, a.id))).length).toBeGreaterThan(0);

    const queued: string[] = [];
    const res = await moveItem({ db: env.db, storage: env.storage, queue: { enqueue: async (id) => void queued.push(id) } }, { itemId: r.item.id, namespace: "english" });
    expect([res.from.name, res.to.name, res.replaced]).toEqual(["robotics", "english", null]);
    expect(res.item.namespaceId).toBe(b.id);
    const segs = await env.db.select({ ns: segments.namespaceId }).from(segments).where(eq(segments.itemId, r.item.id));
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.ns === b.id)).toBe(true);
    expect((await env.db.select().from(entities).where(eq(entities.namespaceId, a.id))).length).toBe(0); // nobody mentions them any more
    const inB = await env.db.select().from(entities).where(eq(entities.namespaceId, b.id));
    expect(inB.length).toBeGreaterThan(0);
    expect(res.reindexed?.mentions).toBeGreaterThan(0);
    expect((await env.db.select().from(mentions).where(eq(mentions.itemId, r.item.id))).length).toBe(res.reindexed?.mentions);
    expect((await loadDocument(env.storage, r.item.id))?.namespace_id).toBe(b.id);

    // a job at the same version that only redoes language + novelty, already on the queue
    expect(res.job).not.toBeNull();
    expect(queued).toEqual([res.job!.id]);
    expect(res.job!.version).toBe(r.job.version);
    expect(res.job!.stages.language).toBeUndefined();
    expect(res.job!.stages.novelty).toBeUndefined();
    expect(res.job!.stages.transcribe?.state).toBe("done");
    const done = await runJob({ ...env, providers }, res.job!.id);
    expect(done.state).toBe("done");
    expect(["done", "skipped"]).toContain(done.stages.language?.state);
    expect(done.stages.transcribe?.finished_at).toBe(res.job!.stages.transcribe?.finished_at); // untouched
  });

  it("refuses to land on a finished copy of the same link, replaces a stalled one, and only moves inside the workspace", async () => {
    const a = await createNamespace(env.db, { name: "a" });
    const b = await createNamespace(env.db, { name: "b" });
    const providers = fakeProviders();
    const url = "https://www.youtube.com/watch?v=move2";
    const inA = await createIngest(env.db, { namespace: a.id, url });
    await runJob({ ...env, providers }, inA.job.id);
    const stalled = await createIngest(env.db, { namespace: b.id, url }); // queued, never run
    const res = await moveItem({ db: env.db, storage: env.storage }, { itemId: inA.item.id, namespace: "b" });
    expect(res.replaced).toBe(stalled.item.id);
    expect(res.item.namespaceId).toBe(b.id);
    // now "b" has the finished one; a new copy in "a" cannot move onto it
    const again = await createIngest(env.db, { namespace: a.id, url });
    await runJob({ ...env, providers }, again.job.id);
    await expect(moveItem({ db: env.db, storage: env.storage }, { itemId: again.item.id, namespace: "b" })).rejects.toThrow(/already has this one/);
    await expect(moveItem({ db: env.db, storage: env.storage }, { itemId: again.item.id, namespace: "nope" })).rejects.toThrow(/not found/);
    // same namespace: a no-op
    const same = await moveItem({ db: env.db, storage: env.storage }, { itemId: again.item.id, namespace: "a" });
    expect([same.job, same.replaced]).toEqual([null, null]);
  });
});
