import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { jobs } from "../db/index.ts";
import { testEnv } from "../pipeline/testkit.ts";
import { createIngest } from "./ingest.ts";
import { createNamespace } from "./namespaces.ts";
import { backfillUsageFromJobs, describeUsage, itemUsage, normalizeSdkUsage, recordChatUsage, recordPipelineUsage, splitTrackerUsage, usageByItem } from "./usage.ts";

describe("spend ledger", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  beforeEach(async () => {
    env = await testEnv();
  });
  afterEach(async () => {
    await env.close();
  });

  it("splits the tracker's flat keys on the metric, not the model's dots", () => {
    expect(splitTrackerUsage({ "gpt-5.6-luna.input_tokens": 800, "gpt-5.6-luna.output_tokens": 40, "gpt-5.6-luna.requests": 1, "whisper-1.audio_seconds": 649, "whisper-1.requests": 1 })).toEqual({
      "gpt-5.6-luna": { input_tokens: 800, output_tokens: 40, requests: 1 },
      "whisper-1": { audio_seconds: 649, requests: 1 },
    });
  });

  it("reads the AI SDK's usage in both shapes", () => {
    expect(normalizeSdkUsage({ inputTokens: 1200, outputTokens: 300, inputTokenDetails: { cacheReadTokens: 1000 } })).toEqual({ input_tokens: 1200, cached_input_tokens: 1000, output_tokens: 300, requests: 1 });
    expect(normalizeSdkUsage({ inputTokens: { total: 10, cacheRead: 4 }, outputTokens: { total: 5 } })).toEqual({ input_tokens: 10, cached_input_tokens: 4, output_tokens: 5, requests: 1 });
    expect(normalizeSdkUsage(undefined)).toEqual({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, requests: 1 });
  });

  it("adds up an item: pipeline stages (retries replace), summary, chat turns", async () => {
    const ns = await createNamespace(env.db, { name: "demo" });
    const r = await createIngest(env.db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=aaa" });
    const base = { itemId: r.item.id, namespaceId: ns.id, jobId: r.job.id };
    await recordPipelineUsage(env.db, { ...base, stage: "transcribe", usage: { "whisper-1.audio_seconds": 600, "whisper-1.requests": 1 } });
    await recordPipelineUsage(env.db, { ...base, stage: "article", usage: { "gpt-5.6-luna.input_tokens": 10_000, "gpt-5.6-luna.output_tokens": 1_000, "gpt-5.6-luna.requests": 1 } });
    await recordPipelineUsage(env.db, { ...base, stage: "article", usage: { "gpt-5.6-luna.input_tokens": 12_000, "gpt-5.6-luna.output_tokens": 1_500, "gpt-5.6-luna.requests": 1 } }); // retried → replaces
    await recordPipelineUsage(env.db, { ...base, stage: "summary", source: "summary", usage: { "gpt-5.6-luna.input_tokens": 2_000, "gpt-5.6-luna.output_tokens": 200, "gpt-5.6-luna.requests": 1 } });
    await recordChatUsage(env.db, { itemId: r.item.id, namespaceId: ns.id, userId: "usr_1", model: "gpt-5.6-terra", usage: { inputTokens: 5_000, outputTokens: 400 }, source: "chat" });
    await recordChatUsage(env.db, { itemId: r.item.id, namespaceId: ns.id, userId: "usr_1", model: "gpt-5.6-terra", usage: { inputTokens: 6_000, outputTokens: 500, inputTokenDetails: { cacheReadTokens: 4_000 } }, source: "chat" });

    const u = await itemUsage(env.db, r.item.id);
    expect(u.pipeline).toMatchObject({ input_tokens: 14_000, output_tokens: 1_700, audio_seconds: 600, requests: 3 });
    expect(u.chat).toMatchObject({ input_tokens: 11_000, output_tokens: 900, cached_input_tokens: 4_000, turns: 2 });
    expect(u.total.total_tokens).toBe(14_000 + 1_700 + 11_000 + 900);
    expect(u.total.cost_usd).toBeCloseTo(u.pipeline.cost_usd + u.chat.cost_usd, 6);
    expect(u.total.cost_usd).toBeGreaterThan(0);
    expect(u.stages.map((s) => s.stage)).toEqual(["transcribe", "article", "summary"]);
    expect(u.stages.find((s) => s.stage === "article")?.input_tokens).toBe(12_000);
    expect(Object.keys(u.models).sort()).toEqual(["gpt-5.6-luna", "gpt-5.6-terra", "whisper-1"]);

    const byItem = await usageByItem(env.db, [r.item.id, "vid_nope"]);
    expect(byItem.get(r.item.id)).toMatchObject({ tokens: u.total.total_tokens });
    expect(byItem.get(r.item.id)?.cost_usd).toBeCloseTo(u.total.cost_usd, 6);
    expect(describeUsage(u.total)).toMatch(/25,000 in \/ 2,600 out \(4,000 cached\) · 10\.0 min audio · \$/);
  });

  it("backfills rows from jobs that predate the ledger, once", async () => {
    const ns = await createNamespace(env.db, { name: "demo" });
    const r = await createIngest(env.db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=bbb" });
    await env.db
      .update(jobs)
      .set({ state: "done", stages: { fetch: { state: "done" }, transcribe: { state: "done", usage: { "whisper-1.audio_seconds": 3600, "whisper-1.requests": 4 }, cost_usd: 0.24 } } })
      .where(eq(jobs.id, r.job.id));
    expect(await backfillUsageFromJobs(env.db)).toBe(1);
    expect(await backfillUsageFromJobs(env.db)).toBe(0);
    const u = await itemUsage(env.db, r.item.id);
    expect(u.pipeline.audio_seconds).toBe(3600);
    expect(u.stages).toHaveLength(1);
  });
});
