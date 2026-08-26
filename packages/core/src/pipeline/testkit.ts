// Fakes for pipeline tests: in-memory PGlite, filesystem storage in a temp dir, and providers that never shell out
// or call OpenAI. Used by runner.test.ts and (later) the API tests.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { createDb } from "../db/index.ts";
import { LocalStorage } from "../storage/local.ts";
import type { Providers } from "./types.ts";

export async function testEnv() {
  const root = await mkdtemp(join(tmpdir(), "marrow-test-"));
  const config = loadConfig({ LOCAL_STORAGE_DIR: join(root, "storage"), WORK_DIR: join(root, "work"), OPENAI_API_KEY: "test" });
  const handle = await createDb({ memory: true });
  const storage = new LocalStorage(config.LOCAL_STORAGE_DIR);
  return { root, config, db: handle.db, storage, close: handle.close };
}

const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

export type FakeOptions = { durationS?: number; hasVideo?: boolean; failAt?: keyof Providers };

/** A 20-minute talk with 3 chapters, 6 scene changes, 2 references. Deterministic. */
export function fakeProviders(opts: FakeOptions = {}): Providers & { calls: Record<string, number> } {
  const duration = opts.durationS ?? 1200;
  const calls: Record<string, number> = {};
  const hit = (name: keyof Providers) => {
    calls[name] = (calls[name] ?? 0) + 1;
    if (opts.failAt === name) throw new Error(`simulated failure in ${name}`);
  };
  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];

  return {
    calls,
    async fetchMetadata(url) {
      hit("fetchMetadata");
      return {
        id: "vid1",
        title: "Sim-to-real for actuators",
        channel: "Test Channel",
        upload_date: "20260101",
        duration,
        chapters: [
          { title: "Intro", start_time: 0, end_time: 300 },
          { title: "Method", start_time: 300, end_time: 800 },
          { title: "Results", start_time: 800, end_time: duration },
        ],
        webpage_url: url,
        description: "A talk.",
      };
    },
    async download(_url, outDir) {
      hit("download");
      await mkdir(outDir, { recursive: true });
      const p = join(outDir, "source.mp4");
      await writeFile(p, "fake-video");
      return p;
    },
    async probe() {
      hit("probe");
      return { duration, hasVideo: opts.hasVideo ?? true, hasAudio: true };
    },
    async extractAudio(_src, out) {
      hit("extractAudio");
      await writeFile(out, "fake-audio");
    },
    async detectSilences() {
      hit("detectSilences");
      return [];
    },
    async cutAudio(_src, _s, _e, out) {
      hit("cutAudio");
      await writeFile(out, "fake-chunk");
    },
    async extractKeyframes(_video, outDir) {
      hit("extractKeyframes");
      await mkdir(outDir, { recursive: true });
      const out = [];
      for (let i = 0; i < 6; i++) {
        const p = join(outDir, `${String(i + 1).padStart(5, "0")}.jpg`);
        await writeFile(p, FAKE_JPEG);
        out.push({ t: 100 + i * 150, score: 0.5 + i * 0.05, path: p });
      }
      return out;
    },
    async transcribe(_path, usage) {
      hit("transcribe");
      usage.add("whisper-1", { audio_seconds: duration, requests: 1 });
      const segments: Array<{ start: number; end: number; text: string }> = [];
      const ws: Array<{ word: string; start: number; end: number }> = [];
      for (let t = 0; t < duration; t += 10) {
        const text = `${words[(t / 10) % words.length]} ${words[(t / 10 + 3) % words.length]} we talk about the Tobin et al paper and domain randomization at ${t}.`;
        segments.push({ start: t, end: t + 10, text });
        text.split(" ").forEach((w, i) => ws.push({ word: w, start: t + i * 0.5, end: t + i * 0.5 + 0.4 }));
      }
      return { language: "en", duration, text: segments.map((s) => s.text).join(" "), segments, words: ws };
    },
    async describeFrame(_jpeg, usage) {
      hit("describeFrame");
      usage.add("gpt-5.6-luna", { input_tokens: 800, output_tokens: 40, requests: 1 });
      return { caption: "Slide: loss curves", ocr_text: "PPO loss" };
    },
    async generate(o, usage) {
      hit("generate");
      usage.add("gpt-5.6-luna", { input_tokens: 5000, output_tokens: 800, requests: 1 });
      if (o.schemaName === "article") {
        return {
          summary: "A talk about sim-to-real transfer.",
          takeaways: ["Domain randomization matters", "Actuator backlash is hard"],
          sections: [
            { heading: "Intro", t_start: 0, body_md: "Intro text." },
            { heading: "Method", t_start: 300, body_md: "Method text." },
            { heading: "Results", t_start: 800, body_md: "Results text." },
          ],
        } as never;
      }
      if (o.schemaName === "enrichment") {
        return {
          references: [
            { kind: "paper", name: "Tobin et al. 2017", raw_mention: "the Tobin et al paper", t: 120, search_query: "Tobin domain randomization 2017 arxiv" },
            { kind: "technique", name: "Domain randomization", raw_mention: "domain randomization", t: 130, search_query: "domain randomization" },
          ],
          claims: [
            { entity: "Domain randomization", claim_text: "Domain randomization is essential for transfer.", stance: "supports", t: 140, quote: "we talk about domain randomization" },
            { entity: null, claim_text: "Backlash compensation matters.", stance: "neutral", t: 900, quote: "…" },
          ],
          entities: [
            { name: "Tobin et al. 2017", kind: "paper", aliases: ["Tobin paper"] },
            { name: "Domain randomization", kind: "technique", aliases: ["DR"] },
          ],
        } as never;
      }
      if (o.schemaName === "resolutions") {
        return { resolutions: [{ name: "Tobin et al. 2017", resolved_url: "https://arxiv.org/abs/1703.06907" }, { name: "Domain randomization", resolved_url: null }] } as never;
      }
      throw new Error(`fake generate: unknown schema ${o.schemaName}`);
    },
    async embed(texts, usage) {
      hit("embed");
      usage.add("text-embedding-3-small", { input_tokens: texts.length * 300, requests: 1 });
      return texts.map((t, i) => {
        const v: number[] = Array.from({ length: 1536 }, () => 0);
        v[i % 1536] = 1;
        const j = (t.length * 7) % 1536;
        v[j] = (v[j] ?? 0) + 0.5;
        return v;
      });
    },
  };
}
