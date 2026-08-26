import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createIngest } from "../../services/ingest.ts";
import { createNamespace } from "../../services/namespaces.ts";
import { documentToText } from "../../services/export.ts";
import { loadDocument, runJob } from "../runner.ts";
import { fakeProviders, testEnv } from "../testkit.ts";

describe("diarize stage (PRD §5 stage 3)", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  beforeEach(async () => {
    env = await testEnv();
    await createNamespace(env.db, { name: "pods" });
  });
  afterEach(async () => {
    await env.close();
  });

  it("stays single-speaker for a plain talk", async () => {
    const res = await createIngest(env.db, { namespace: "pods", url: "https://www.youtube.com/watch?v=tiling-lecture" });
    const providers = fakeProviders({ durationS: 120 });
    const job = await runJob({ ...env, providers }, res.job.id);
    expect(job.stages.diarize?.state).toBe("skipped");
    expect(providers.calls.diarize).toBeUndefined();
    const doc = (await loadDocument(env.storage, res.item.id))!;
    expect(doc.speakers).toEqual([{ id: "S1", label: "Speaker 1" }]);
  });

  it("diarizes a podcast, aligns speakers onto the transcript, and names them", async () => {
    const res = await createIngest(env.db, { namespace: "pods", url: "https://www.youtube.com/watch?v=podcast-episode-12-interview" });
    const providers = fakeProviders({ durationS: 900 });
    const job = await runJob({ ...env, providers }, res.job.id);
    expect(job.stages.diarize?.state).toBe("done");
    expect(job.stages.diarize?.cost_usd).toBeGreaterThan(0);
    expect(providers.calls.diarize).toBe(2); // 900 s → pieces of ≤ 483 s (420 × 1.15): [0, 483] + [483, 900]; reference clips carry labels into the second
    const doc = (await loadDocument(env.storage, res.item.id))!;
    expect(doc.speakers).toEqual([
      { id: "S1", label: "Host" },
      { id: "S2", label: "Guest 1" },
    ]);
    const ids = new Set(doc.transcript.map((e) => e.speaker));
    expect([...ids].sort()).toEqual(["S1", "S2"]);
    // 30 s alternation in the fake: entries at 0–29 → S1, 30–59 → S2 …
    expect(doc.transcript.find((e) => e.t_start === 0)!.speaker).toBe("S1");
    expect(doc.transcript.find((e) => e.t_start === 30)!.speaker).toBe("S2");
    const txt = documentToText(doc);
    expect(txt).toContain("SPEAKERS\nS1: Host\nS2: Guest 1");
    expect(txt).toMatch(/\[00:00\] Host: /);
    expect(txt).toMatch(/\[00:30\] Guest 1: /);
  });

  it("honours the namespace flag", async () => {
    await createNamespace(env.db, { name: "forced", flags: { diarize: true } });
    const res = await createIngest(env.db, { namespace: "forced", url: "https://www.youtube.com/watch?v=plain-talk" });
    const providers = fakeProviders({ durationS: 60 });
    const job = await runJob({ ...env, providers }, res.job.id);
    expect(job.stages.diarize?.state).toBe("done");
    expect(providers.calls.diarize).toBe(1);
  });
});
