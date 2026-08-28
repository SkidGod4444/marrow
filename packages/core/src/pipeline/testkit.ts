// Fakes for pipeline tests: in-memory PGlite, filesystem storage in a temp dir, and providers that never shell out
// or call OpenAI. Used by runner.test.ts and (later) the API tests.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../config.ts";
import { createDb } from "../db/index.ts";
import { LocalStorage } from "../storage/local.ts";
import type { PageContent } from "../capture/page.ts";
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
    fetchPage: async (url: string) => fakePage(url),
    fetchFeed: async () => ({ title: null, site_url: null, entries: [] }),
  };
}

/** A real 1×1 JPEG so browsers render fake keyframes instead of a broken image. */
const FAKE_JPEG = Uint8Array.from(atob("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgA//Z"), (c) => c.charCodeAt(0));

/** A real 2-second silent WAV (8 kHz, 16-bit mono) so the web player can actually play fake audio. */
export function fakeWav(seconds = 2): Uint8Array {
  const rate = 8000;
  const samples = rate * seconds;
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  return new Uint8Array(buf);
}

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
  const chunkLen = new Map<string, number>(); // chunk file → seconds, so fake transcripts add up to the whole
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
      await writeFile(out, fakeWav());
    },
    async detectSilences() {
      hit("detectSilences");
      return [];
    },
    async cutAudio(_src, s, e, out) {
      hit("cutAudio");
      chunkLen.set(out, e - s); // the fake transcribe then speaks for exactly this piece (timestamps relative to it)
      await writeFile(out, "fake-chunk");
    },
    async cutClip(_src, _s, _e, out) {
      hit("cutClip");
      await writeFile(out, fakeWav(1));
    },
    async extractEvenFrames(_video, outDir, everyS) {
      hit("extractEvenFrames");
      await mkdir(outDir, { recursive: true });
      const out = [];
      for (let t = everyS, i = 0; t < duration; t += everyS, i++) {
        const p = join(outDir, `${String(i + 1).padStart(5, "0")}.jpg`);
        await writeFile(p, FAKE_JPEG);
        out.push({ t, score: 0.05, path: p });
      }
      return out;
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
    async transcribe(path, usage) {
      hit("transcribe");
      const d = chunkLen.get(path) ?? duration;
      if (topic.includes("broken")) throw new Error("simulated transcription failure");
      if (topic.includes("slow")) await new Promise((r) => setTimeout(r, 8000)); // lets the UI show a job in flight
      usage.add("whisper-1", { audio_seconds: d, requests: 1 });
      const segments: Array<{ start: number; end: number; text: string }> = [];
      const ws: Array<{ word: string; start: number; end: number }> = [];
      for (let t = 0; t < d; t += 10) {
        const text = `${words[(t / 10) % words.length]} ${words[(t / 10 + 3) % words.length]} on ${topic}: we talk about the Tobin et al paper and domain randomization at ${t}.`;
        segments.push({ start: t, end: t + 10, text });
        text.split(" ").forEach((w, i) => ws.push({ word: w, start: t + i * 0.5, end: t + i * 0.5 + 0.4 }));
      }
      return { language: "en", duration: d, text: segments.map((s) => s.text).join(" "), segments, words: ws };
    },
    async diarize(_path, o, usage) {
      hit("diarize");
      usage.add("gpt-4o-transcribe-diarize", { audio_seconds: duration, requests: 1 });
      const names = o.known?.length ? o.known.map((k) => k.name) : ["A", "B"];
      const segs = [];
      for (let t = 0; t < duration; t += 30) segs.push({ start: t, end: Math.min(duration, t + 30), speaker: names[(t / 30) % names.length]!, text: "…" });
      return segs;
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
      if (o.schemaName === "speaker_labels") {
        const input = JSON.parse(o.user as string) as { speakers: string[] };
        return { speakers: input.speakers.map((id, i) => ({ id, label: i === 0 ? "Host" : `Guest ${i}` })) } as never;
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
      if (o.schemaName === "language_pack") {
        const kinds = ["idiom", "phrasal_verb", "collocation", "slang", "other"] as const;
        const picks = [
          ["talk about", 0], ["we talk about", 10], ["the Tobin et al paper", 20], ["domain randomization", 30], ["talk about the", 40], ["paper and domain", 50],
          ["randomization at", 60], ["on sim", 70], ["et al", 80], ["about the Tobin", 90], ["we talk", 100], ["and domain randomization", 110],
        ];
        return { expressions: picks.map(([text, t], i) => ({ text, kind: kinds[i % kinds.length], explanation: `Meaning of "${text}" — used here in a technical conversation.`, t })) } as never;
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
    async fetchPage(url) {
      hit("fetchPage");
      return fakePage(url);
    },
    async downloadUrl(_url, outDir) {
      hit("downloadUrl");
      await mkdir(outDir, { recursive: true });
      const p = join(outDir, "source.wav");
      await writeFile(p, fakeWav());
      return p;
    },
  };
}

/** Deterministic captured page: a short post about the URL's last path segment, with one YouTube link and one paper. */
export function fakePage(url: string): PageContent {
  const u = new URL(url);
  const slug = u.pathname.split("/").filter(Boolean).pop() ?? "post";
  const topic = slug.replace(/[-_]+/g, " ");
  return {
    url,
    final_url: url,
    content_type: u.pathname.endsWith(".pdf") ? "pdf" : "html",
    title: `Post: ${topic}`,
    author: "Ada Author",
    site_name: u.hostname,
    description: `A post about ${topic}.`,
    published_at: "2026-02-01T00:00:00.000Z",
    body_md: `# ${topic}\n\nThis post is about ${topic}. It cites the Tobin et al paper on domain randomization and links a talk: https://www.youtube.com/watch?v=dQw4w9WgXcQ\n\nSecond paragraph: actuator backlash is hard, and ${topic} matters for sim-to-real.`,
    links: ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://arxiv.org/abs/1703.06907"],
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
