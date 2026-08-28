import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { expressionReviews, items } from "../db/index.ts";
import { loadDocument, runJob } from "../pipeline/runner.ts";
import { locateSpan } from "../pipeline/stages/language.ts";
import { fakeProviders, testEnv } from "../pipeline/testkit.ts";
import { createIngest } from "./ingest.ts";
import { answerReview, listExpressions, nextDue, reviewQueue, reviewSummary, saveExpression, unsaveExpression } from "./language.ts";
import { createNamespace, updateNamespaceFlags } from "./namespaces.ts";

describe("language mode (PRD §6.3)", () => {
  it("locates an expression's exact word span near the cited time, falling back to the line", () => {
    const transcript = [
      { t_start: 0, t_end: 4, speaker: "S1", text: "We talk about the Tobin paper.", words: [{ w: "We", t: 0, t_end: 0.3 }, { w: "talk", t: 0.4, t_end: 0.7 }, { w: "about", t: 0.8, t_end: 1.1 }, { w: "the", t: 1.2, t_end: 1.3 }, { w: "Tobin", t: 1.4, t_end: 1.8 }, { w: "paper.", t: 1.9, t_end: 2.3 }] },
      { t_start: 4, t_end: 8, speaker: "S1", text: "Backlash is hard.", words: [{ w: "Backlash", t: 4, t_end: 4.5 }, { w: "is", t: 4.6, t_end: 4.7 }, { w: "hard.", t: 4.8, t_end: 5.2 }] },
    ];
    expect(locateSpan(transcript, "talk about", 0)).toEqual({ t_start: 0.4, t_end: 1.1, exact: true, context: "We talk about the Tobin paper." });
    expect(locateSpan(transcript, "Tobin paper", 3)).toEqual({ t_start: 1.4, t_end: 2.3, exact: true, context: "We talk about the Tobin paper." });
    expect(locateSpan(transcript, "not in there", 4)).toEqual({ t_start: 4, t_end: 8, exact: false, context: "Backlash is hard." });
    expect(locateSpan([], "x", 0)).toBeNull();
  });

  it("schedules 2d → 7d → 30d, then every 30d", () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    expect(nextDue(0, t0).toISOString()).toBe("2026-01-03T00:00:00.000Z");
    expect(nextDue(1, t0).toISOString()).toBe("2026-01-08T00:00:00.000Z");
    expect(nextDue(2, t0).toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(nextDue(7, t0).toISOString()).toBe("2026-01-31T00:00:00.000Z");
  });

  describe("pipeline + review queue", () => {
    let env: Awaited<ReturnType<typeof testEnv>>;
    beforeEach(async () => {
      env = await testEnv();
      await createNamespace(env.db, { name: "english", flags: { language_learning: true } });
      await createNamespace(env.db, { name: "plain" });
    });
    afterEach(async () => {
      await env.close();
    });

    it("a podcast in a language namespace yields ≥10 expressions with exact-span clips; plain namespaces skip the pass", async () => {
      const providers = fakeProviders({ durationS: 1500, hasVideo: false });
      const res = await createIngest(env.db, { namespace: "english", url: "https://www.youtube.com/watch?v=podcast-episode-12", sourceType: "podcast_episode" });
      const job = await runJob({ ...env, providers }, res.job.id);
      expect(job.stages.language?.state).toBe("done");
      const doc = (await loadDocument(env.storage, res.item.id))!;
      const ex = doc.language_pack?.expressions ?? [];
      expect(ex.length).toBeGreaterThanOrEqual(10);
      for (const e of ex) {
        expect(e.t_end).toBeGreaterThan(e.t_start);
        expect(e.t_end - e.t_start).toBeLessThan(15);
        expect(e.clip_s3_key).toMatch(new RegExp(`^clips/${res.item.id}/\\d+\\.m4a$`));
        expect(await env.storage.exists(e.clip_s3_key!)).toBe(true);
      }
      expect(providers.calls.cutClip).toBe(ex.length);
      const listed = (await listExpressions(env, res.item.id))!;
      expect(listed.expressions[0]).toMatchObject({ n: 0, saved: false, clip_url: `/items/${res.item.id}/clips/0` });
      expect(listed.expressions[0]!.deep_link).toContain("t=");

      const plain = await createIngest(env.db, { namespace: "plain", url: "https://www.youtube.com/watch?v=abc", sourceType: "podcast_episode" });
      const job2 = await runJob({ ...env, providers: fakeProviders({ hasVideo: false }) }, plain.job.id);
      expect(job2.stages.language?.state).toBe("skipped");
      expect((await loadDocument(env.storage, plain.item.id))!.language_pack).toBeNull();

      // Flip the flag and re-run only the language stage: the pack appears without redoing transcription.
      await updateNamespaceFlags(env.db, "plain", { language_learning: true });
      const again = await createIngest(env.db, { namespace: "plain", url: "https://www.youtube.com/watch?v=abc", force: true });
      const p2 = fakeProviders({ hasVideo: false });
      await runJob({ ...env, providers: p2 }, again.job.id);
      expect((await loadDocument(env.storage, plain.item.id))!.language_pack?.expressions.length).toBeGreaterThanOrEqual(10);
    });

    it("learn → due in 2 days; got it → 7 → 30; again → back to 2; unsave removes it", async () => {
      const res = await createIngest(env.db, { namespace: "english", url: "https://www.youtube.com/watch?v=podcast-episode-12", sourceType: "podcast_episode" });
      await runJob({ ...env, providers: fakeProviders({ hasVideo: false }) }, res.job.id);
      const saved = await saveExpression(env, res.item.id, 2);
      expect(saved.stage).toBe(0);
      expect(saved.dueAt.getTime() - Date.now()).toBeGreaterThan(1.9 * 24 * 3600 * 1000);
      expect((await saveExpression(env, res.item.id, 2)).id).toBe(saved.id); // idempotent
      const listed = (await listExpressions(env, res.item.id))!;
      expect(listed.expressions[2]?.saved).toBe(true);
      const [ev] = await env.db.select().from(items).where(eq(items.id, res.item.id));
      expect(ev).toBeTruthy();

      const now = new Date();
      let q = await reviewQueue(env.db, { now });
      expect(q.due).toHaveLength(0);
      expect(q.upcoming).toHaveLength(1);
      const later = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
      q = await reviewQueue(env.db, { now: later });
      expect(q.due).toHaveLength(1);
      expect(q.due[0]).toMatchObject({ text: listed.expressions[2]!.text, item_title: listed.title, clip_url: `/items/${res.item.id}/clips/2` });
      expect((await reviewSummary(env.db, later)).due).toBe(1);

      const r1 = (await answerReview(env.db, saved.id, "got_it", later))!;
      expect(r1.stage).toBe(1);
      expect(r1.dueAt.toISOString()).toBe(new Date(later.getTime() + 7 * 24 * 3600 * 1000).toISOString());
      const r2 = (await answerReview(env.db, saved.id, "got_it", later))!;
      expect(r2.stage).toBe(2);
      expect(r2.dueAt.getTime() - later.getTime()).toBe(30 * 24 * 3600 * 1000);
      const r3 = (await answerReview(env.db, saved.id, "again", later))!;
      expect(r3.stage).toBe(0);
      expect(r3.dueAt.getTime() - later.getTime()).toBe(2 * 24 * 3600 * 1000);
      expect(r3.reviews).toBe(3);

      expect(await unsaveExpression(env.db, res.item.id, 2)).toBe(true);
      expect(await env.db.select().from(expressionReviews)).toHaveLength(0);
      await expect(saveExpression(env, res.item.id, 99)).rejects.toThrow(/not found/);
    });
  });
});
