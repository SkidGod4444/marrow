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
  const config = loadConfig({ LOCAL_STORAGE_DIR: join(root, "storage"), WORK_DIR: join(root, "work"), OPENAI_API_KEY: "test", POLL_EVERY_MINUTES: "0" });
  const handle = await createDb({ memory: true });
  const storage = new LocalStorage(config.LOCAL_STORAGE_DIR);
  const providers = fakeProviders();
  return {
    root,
    config,
    db: handle.db,
    storage,
    close: handle.close,
    // Server-side fakes (no yt-dlp / OpenAI): query embeddings, playlist listings, structured generation.
    embedQuery: async (q: string) => fakeEmbedding(q),
    listEntries: fakeListing,
    generate: providers.generate,
  };
}

const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);

/** Deterministic hashed bag-of-words vector — cosine similarity tracks term overlap, so hybrid search is testable. */
export function fakeEmbedding(text: string, dims = 1536): number[] {
  const v: number[] = Array.from({ length: dims }, () => 0);
  for (const w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    const j = Math.abs(h) % dims;
    v[j] = (v[j] ?? 0) + 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export type FakeOptions = { durationS?: number; hasVideo?: boolean; failAt?: keyof Providers; topic?: string };

/** A 20-minute talk with 3 chapters, 6 scene changes, 2 references. Deterministic. */
export function fakeProviders(opts: FakeOptions = {}): Providers & { calls: Record<string, number> } {
  const duration = opts.durationS ?? 1200;
  const calls: Record<string, number> = {};
  const hit = (name: keyof Providers) => {
    calls[name] = (calls[name] ?? 0) + 1;
    if (opts.failAt === name) throw new Error(`simulated failure in ${name}`);
  };
  const words = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
  let topic = "sim-to-real for actuators";
  const topicOf = (url: string) => {
    const id = new URL(url).searchParams.get("v") ?? "";
    return id.includes("-") ? id.replace(/[-_]+/g, " ") : (opts.topic ?? "sim-to-real for actuators");
  };

  return {
    calls,
    async fetchMetadata(url) {
      hit("fetchMetadata");
      topic = topicOf(url);
      return {
        id: "vid1",
        title: `Talk: ${topic}`,
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
        const text = `${words[(t / 10) % words.length]} ${words[(t / 10 + 3) % words.length]} on ${topic}: we talk about the Tobin et al paper and domain randomization at ${t}.`;
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
      if (o.schemaName === "novelty") {
        const input = JSON.parse(o.user as string) as { sections: Array<{ i: number; heading: string; matches: Array<{ item_id: string; t: number | null }> }> };
        return {
          sections: input.sections.map((s, idx) => ({
            i: s.i,
            label: idx === 0 && s.matches.length ? "known" : "new",
            topic: s.heading.toLowerCase(),
            covered_by: idx === 0 ? s.matches.slice(0, 2).map((m) => ({ item_id: m.item_id, t: m.t })) : [],
          })),
        } as never;
      }
      if (o.schemaName === "namespace_summary") {
        const input = JSON.parse(o.user as string) as { items: Array<{ title: string }>; entities: Array<{ name: string }> };
        return { summary: `Corpus of ${input.items.length} items covering ${input.items.map((i) => i.title).slice(0, 3).join(", ")}. Recurring: ${input.entities.map((e) => e.name).join(", ")}. Disagreements: none recorded.` } as never;
      }
      if (o.schemaName === "resolutions") {
        return { resolutions: [{ name: "Tobin et al. 2017", resolved_url: "https://arxiv.org/abs/1703.06907" }, { name: "Domain randomization", resolved_url: null }] } as never;
      }
      throw new Error(`fake generate: unknown schema ${o.schemaName}`);
    },
    async embed(texts, usage) {
      hit("embed");
      usage.add("text-embedding-3-small", { input_tokens: texts.length * 300, requests: 1 });
      return texts.map((t) => fakeEmbedding(t));
    },
  };
}

/** Fake playlist/channel listing for polling tests: three deterministic entries derived from the URL. */
export async function fakeListing(url: string): Promise<{ title: string | null; entries: Array<{ id: string; title: string; url: string }> }> {
  const key = url.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(-24);
  return {
    title: `Playlist ${key}`,
    entries: [1, 2, 3].map((n) => ({ id: `${key}-v${n}`, title: `Video ${n} of ${key}`, url: `https://www.youtube.com/watch?v=${key}-v${n}` })),
  };
}
