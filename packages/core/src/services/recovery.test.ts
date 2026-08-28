import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs } from "../db/index.ts";
import { testEnv } from "../pipeline/testkit.ts";
import { createIngest } from "./ingest.ts";
import { failJobIfUnstarted, queueStats, recoverJobs } from "./jobs.ts";
import { createNamespace } from "./namespaces.ts";

describe("jobs left behind by a previous process", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  beforeEach(async () => {
    env = await testEnv();
  });
  afterEach(async () => {
    await env.close();
  });

  it("recoverJobs re-sends queued and running jobs, not finished ones; queueStats counts them", async () => {
    const ns = await createNamespace(env.db, { name: "demo" });
    const a = await createIngest(env.db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=aaa" });
    const b = await createIngest(env.db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=bbb" });
    const c = await createIngest(env.db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=ccc" });
    const d = await createIngest(env.db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=ddd" });
    await env.db.update(jobs).set({ state: "running", stage: "transcribe", updatedAt: new Date(Date.now() - 5 * 60_000) }).where(eq(jobs.id, b.job.id));
    await env.db.update(jobs).set({ state: "done" }).where(eq(jobs.id, c.job.id));
    await env.db.update(jobs).set({ state: "failed", error: "transcribe: boom" }).where(eq(jobs.id, d.job.id));

    const sent: string[] = [];
    const recovered = await recoverJobs(env.db, { enqueue: async (id) => void sent.push(id) });
    expect(recovered.sort()).toEqual([a.job.id, b.job.id].sort());
    expect(sent.sort()).toEqual([a.job.id, b.job.id].sort());

    const stats = await queueStats(env.db);
    expect(stats).toMatchObject({ queued: 1, running: 1, failed: 1 });
    expect(stats.oldest_queued_s).toBeGreaterThanOrEqual(0);
    expect(stats.running_since_progress_s).toBeGreaterThanOrEqual(5 * 60 - 5);
  });

  it("failJobIfUnstarted records a failure that happened before the first stage, once", async () => {
    const ns = await createNamespace(env.db, { name: "demo" });
    const r = await createIngest(env.db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=eee" });
    expect(await failJobIfUnstarted(env.db, r.job.id, new Error("Could not load credentials from any providers"))).toBe(true);
    const [job] = await env.db.select().from(jobs).where(eq(jobs.id, r.job.id));
    expect(job).toMatchObject({ state: "failed", error: "start: Could not load credentials from any providers" });
    expect((await queueStats(env.db)).failed).toBe(1);
    // already failed (the runner did it, or we did): nothing to add
    expect(await failJobIfUnstarted(env.db, r.job.id, new Error("again"))).toBe(false);
    expect(await failJobIfUnstarted(env.db, "job_nope", new Error("x"))).toBe(false);
  });
});
