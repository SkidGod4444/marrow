import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entities, jobs, mentions, segments } from "../db/index.ts";
import { documentKey, rawPrefix } from "../document.ts";
import { createIngest } from "../services/ingest.ts";
import { createNamespace } from "../services/namespaces.ts";
import { getJobStatus } from "../services/jobs.ts";
import { loadDocument, runJob } from "./runner.ts";
import { fakeProviders, testEnv } from "./testkit.ts";

const URL = "https://www.youtube.com/watch?v=abc123";

describe("pipeline runner (Phase 1 acceptance)", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  beforeEach(async () => {
    env = await testEnv();
  });
  afterEach(async () => {
    await env.close();
  });

  it("ingests a video end-to-end: document, ≤120 frames/hr, article, references, segments; idempotent re-run", async () => {
    const ns = await createNamespace(env.db, { name: "sim-to-real" });
    const res = await createIngest(env.db, { namespace: "sim-to-real", url: `${URL}&list=PL1` });
    expect(res.item.sourceUrl).toBe(URL);
    expect(res.reused).toBe(false);

    const providers = fakeProviders({ durationS: 3600 });
    const job = await runJob({ ...env, providers }, res.job.id);
    expect(job.state).toBe("done");

    const doc = await loadDocument(env.storage, res.item.id);
    expect(doc).not.toBeNull();
    expect(doc!.title).toBe("Talk: sim-to-real for actuators");
    expect(doc!.transcript.length).toBe(360);
    expect(doc!.transcript[0]!.words.length).toBeGreaterThan(5); // word-level timestamps
    expect(doc!.frames.length).toBeGreaterThan(0);
    expect(doc!.frames.length).toBeLessThanOrEqual(120);
    expect(doc!.frames.every((f) => f.caption && f.s3_key.startsWith(`frames/${res.item.id}/`))).toBe(true);
    expect(doc!.article?.sections.length).toBe(3);
    expect(doc!.references.find((r) => r.name === "Tobin et al. 2017")?.resolved_url).toBe("https://arxiv.org/abs/1703.06907");
    expect(doc!.pipeline.stages_completed).toEqual(["fetch", "transcribe", "frames", "vision", "article", "enrich", "segment"]);

    const segs = await env.db.select().from(segments).where(eq(segments.itemId, res.item.id));
    expect(segs.length).toBeGreaterThan(10);
    expect(segs.every((s) => s.embedding?.length === 1536 && s.tStart !== null)).toBe(true);
    expect(segs.some((s) => s.frameIds.length > 0)).toBe(true);

    const ents = await env.db.select().from(entities).where(eq(entities.namespaceId, ns.id));
    expect(ents.map((e) => e.name).sort()).toEqual(["Domain randomization", "Tobin et al. 2017"]);
    const mens = await env.db.select().from(mentions).where(eq(mentions.itemId, res.item.id));
    expect(mens.filter((m) => m.stance === "supports")).toHaveLength(1);

    // Cost logged per stage and in total (PRD §13).
    const status = await getJobStatus(env.db, job.id);
    expect(status!.job.costUsd).toBeGreaterThan(0);
    expect(status!.progress.find((p) => p.stage === "transcribe")!.cost_usd).toBeCloseTo(0.36, 2);
    expect(status!.progress.find((p) => p.stage === "diarize")!.state).toBe("skipped");
    expect(status!.item.status).toBe("ready");

    // Raw media cleaned up, derived artifacts kept.
    expect(await env.storage.list(rawPrefix(res.item.id))).toEqual([]);
    expect(await env.storage.exists(documentKey(res.item.id))).toBe(true);

    // Idempotent: same URL again → same item, nothing re-run.
    const again = await createIngest(env.db, { namespace: "sim-to-real", url: "https://youtu.be/abc123" });
    expect(again.reused).toBe(true);
    expect(again.item.id).toBe(res.item.id);
    expect(again.job.id).toBe(res.job.id);
    const before = { ...providers.calls };
    await runJob({ ...env, providers }, again.job.id);
    expect(providers.calls).toEqual(before);

    // --force → version 2 job, derived artifacts replaced.
    const forced = await createIngest(env.db, { namespace: "sim-to-real", url: URL, force: true });
    expect(forced.job.version).toBe(2);
    await runJob({ ...env, providers }, forced.job.id);
    const doc2 = await loadDocument(env.storage, res.item.id);
    expect(doc2!.pipeline.version).toBe(2);
    const segs2 = await env.db.select().from(segments).where(eq(segments.itemId, res.item.id));
    expect(segs2.length).toBe(segs.length);
  });

  it("resumes at the failed stage without redoing earlier ones", async () => {
    await createNamespace(env.db, { name: "kv-cache" });
    const res = await createIngest(env.db, { namespace: "kv-cache", url: URL });

    const failing = fakeProviders({ failAt: "describeFrame" });
    await expect(runJob({ ...env, providers: failing }, res.job.id)).rejects.toThrow(/simulated failure/);
    const [failed] = await env.db.select().from(jobs).where(eq(jobs.id, res.job.id));
    expect(failed!.state).toBe("failed");
    expect(failed!.stage).toBe("vision");
    expect(failed!.stages.fetch?.state).toBe("done");
    expect(failed!.stages.transcribe?.state).toBe("done");
    expect(failed!.stages.vision?.state).toBe("failed");

    const resumed = await createIngest(env.db, { namespace: "kv-cache", url: URL });
    expect(resumed.job.id).toBe(res.job.id);
    const ok = fakeProviders();
    const job = await runJob({ ...env, providers: ok }, res.job.id);
    expect(job.state).toBe("done");
    expect(ok.calls.fetchMetadata).toBeUndefined();
    expect(ok.calls.transcribe).toBeUndefined();
    expect(ok.calls.extractKeyframes).toBeUndefined();
    expect(ok.calls.describeFrame).toBeGreaterThan(0);
  });

  it("skips frames/vision for audio-only sources", async () => {
    await createNamespace(env.db, { name: "podcasts" });
    const res = await createIngest(env.db, { namespace: "podcasts", url: URL });
    const job = await runJob({ ...env, providers: fakeProviders({ hasVideo: false }) }, res.job.id);
    expect(job.stages.frames?.state).toBe("skipped");
    expect(job.stages.vision?.state).toBe("skipped");
    const doc = await loadDocument(env.storage, res.item.id);
    expect(doc!.frames).toEqual([]);
    expect(doc!.article).not.toBeNull();
  });
});
