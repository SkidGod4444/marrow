import { createOpenAI } from "@ai-sdk/openai";
import { recordChatUsage } from "./usage.ts";
import { type LanguageModel, type UIMessage, convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import type { VideoDocument } from "../document.ts";
import { frameLines, referenceLines, textContext, transcriptContext } from "../pipeline/context.ts";
import { isTextSource } from "../ids.ts";
import type { Storage } from "../storage/index.ts";
import { fmtTs } from "../timefmt.ts";

/**
 * PRD §6.1 per-video chat. The system prompt is a STATIC prefix (instructions + full "[MM:SS] text" transcript +
 * metadata/chapters + keyframes as text + references) so the provider's prompt cache hits on every turn; anything
 * dynamic (playback position) is appended to the latest user message instead.
 */
export function buildVideoChatSystem(doc: VideoDocument): string {
  if (isTextSource(doc.source_type)) {
    return [
      `You are Marrow, a research assistant for ONE captured text (a ${doc.source_type.replace(/_/g, " ")}). You have its full text below and the references it mentions.

Rules:
- Answer from the text. Quote or paraphrase closely and say where in the piece it appears (section heading or a short quote); there are no timestamps.
- Use web_search / fetch_url only to follow references outward (papers, repos, people) or check facts outside the text; say when information comes from the web rather than the text.
- Be concrete and concise. Use markdown. Never invent quotes.`,
      textContext(doc),
      referenceLines(doc),
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    `You are Marrow, a research assistant for ONE video. You have its full timestamped transcript below, plus a list of keyframes (what was on screen, as text) and the references it name-drops.

Rules:
- Answer from the transcript. Every claim you attribute to the video must carry a timestamp citation in the form [MM:SS] (or [H:MM:SS]) taken from the transcript lines. Cite the moment where it is said, not the section start.
- When the user asks what is on screen, or a question depends on a slide/chart/code/demo, call view_frame(t) with the relevant time (use the playback position if given) and describe what you actually see.
- Use web_search / fetch_url only to follow references outward (papers, repos, people) or check facts outside the video; say when information comes from the web rather than the video.
- Be concrete and concise. Use markdown. Never invent quotes.`,
    transcriptContext(doc),
    frameLines(doc),
    referenceLines(doc),
  ]
    .filter(Boolean)
    .join("\n\n");
}

export type ChatDeps = { config: Config; storage: Storage; db: Db; model?: LanguageModel };

export type ViewFrameOutput =
  | { error: string }
  | { error?: undefined; frame_id: string; t: number; timestamp: string; caption: string | null; ocr_text: string | null; image_base64: string };

/** What the model sees for a view_frame result: the JPEG itself plus caption/OCR (PRD §6.1 `view_frame(t)` loads the image into context). */
export function viewFrameModelOutput(output: ViewFrameOutput) {
  if (output.error !== undefined) return { type: "error-text" as const, value: output.error };
  return {
    type: "content" as const,
    value: [
      { type: "file-data" as const, data: output.image_base64, mediaType: "image/jpeg" },
      { type: "text" as const, text: `Keyframe at [${output.timestamp}]. Caption: ${output.caption ?? "—"}. On-screen text: ${output.ocr_text || "—"}` },
    ],
  };
}

export function videoChatTools(deps: ChatDeps, doc: VideoDocument) {
  const openai = deps.config.OPENAI_API_KEY ? createOpenAI({ apiKey: deps.config.OPENAI_API_KEY }) : null;

  const view_frame = tool({
    description: "Load the keyframe nearest to time t (seconds into the video) so you can see what is on screen: slides, charts, code, demos. Returns the image plus its caption and OCR text.",
    inputSchema: z.object({ t: z.number().min(0).describe("Seconds into the video") }),
    execute: async ({ t }): Promise<ViewFrameOutput> => {
      if (!doc.frames.length) return { error: "this item has no keyframes (audio-only)" };
      const frame = doc.frames.reduce((best, f) => (Math.abs(f.t - t) < Math.abs(best.t - t) ? f : best));
      const bytes = await deps.storage.get(frame.s3_key);
      return {
        frame_id: frame.id,
        t: frame.t,
        timestamp: fmtTs(frame.t),
        caption: frame.caption ?? null,
        ocr_text: frame.ocr_text ?? null,
        image_base64: Buffer.from(bytes).toString("base64"),
      };
    },
    toModelOutput: ({ output }) => viewFrameModelOutput(output),
  });

  const fetch_url = tool({
    description: "Fetch a public web page (paper abstract, repo README, article) and return its readable text. Use it to follow a reference outward.",
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      const res = await fetch(url, { headers: { "user-agent": "marrow/0.1 (+research assistant)", accept: "text/html,text/plain,application/json" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { url, status: res.status, text: "" };
      const raw = await res.text();
      return { url, status: res.status, text: htmlToText(raw).slice(0, 20_000) };
    },
  });

  return {
    view_frame,
    fetch_url,
    ...(openai ? { web_search: openai.tools.webSearch() } : {}),
  };
}

export type VideoChatInput = { doc: VideoDocument; messages: UIMessage[]; playbackT?: number | null; userId?: string | null };

/** Streams a UI-message response (AI SDK protocol) for `useChat`. */
export async function streamVideoChat(deps: ChatDeps, input: VideoChatInput): Promise<Response> {
  const { config } = deps;
  const model = deps.model ?? createOpenAI({ apiKey: config.OPENAI_API_KEY })(config.LLM_MODEL_CHAT);
  const tools = videoChatTools(deps, input.doc);
  const messages = withPlaybackPosition(input.messages, input.playbackT);
  const result = streamText({
    model,
    system: buildVideoChatSystem(input.doc),
    messages: await convertToModelMessages(messages, { tools }),
    tools,
    stopWhen: stepCountIs(6),
    providerOptions: {
      openai: { reasoningEffort: "low", textVerbosity: "medium", promptCacheKey: `marrow:${input.doc.id}:v${input.doc.pipeline.version}` },
    },
    // Every turn lands in the spend ledger, so the item's total includes what people asked it.
    onFinish: async ({ totalUsage }) => {
      await recordChatUsage(deps.db, { itemId: input.doc.id, namespaceId: input.doc.namespace_id, userId: input.userId ?? null, model: config.LLM_MODEL_CHAT, usage: totalUsage, source: "chat" }).catch(() => undefined);
    },
  });
  return result.toUIMessageStreamResponse();
}

/** Append the player position to the latest user message (dynamic, so it never disturbs the cached prefix). */
export function withPlaybackPosition(messages: UIMessage[], playbackT?: number | null): UIMessage[] {
  if (playbackT === null || playbackT === undefined || !messages.length) return messages;
  const last = messages[messages.length - 1]!;
  if (last.role !== "user") return messages;
  const note = `\n\n(Player is at [${fmtTs(playbackT)}], t=${Math.floor(playbackT)}s.)`;
  const parts = last.parts.map((p, i) => (p.type === "text" && i === last.parts.findLastIndex((q) => q.type === "text") ? { ...p, text: p.text + note } : p));
  return [...messages.slice(0, -1), { ...last, parts }];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{2,}/g, "\n\n")
    .trim();
}

// ---- PRD §6.1 per-namespace chat: summary + entity headline as context, the §8 retrieval tools as tools ----

import { desc as _desc, eq as _eq, count as _count } from "drizzle-orm";
import { type Namespace, entities as _entities, items as _items, mentions as _mentions } from "../db/index.ts";
import { getContext } from "./context.ts";
import { getDocument, presentDocument } from "./documents.ts";
import { lookupEntity } from "./entities.ts";
import { getFrame } from "./frames.ts";
import { search, type SearchDeps } from "./search.ts";

export type NamespaceChatDeps = ChatDeps & Pick<SearchDeps, "embedQuery" | "rerank">;

export async function buildNamespaceChatSystem(db: Db, ns: Namespace): Promise<string> {
  const ready = await db.select({ id: _items.id, title: _items.title, channel: _items.channel }).from(_items).where(_eq(_items.namespaceId, ns.id)).orderBy(_desc(_items.createdAt)).limit(80);
  const ents = await db
    .select({ name: _entities.name, kind: _entities.kind, n: _count(_mentions.id) })
    .from(_entities)
    .leftJoin(_mentions, _eq(_mentions.entityId, _entities.id))
    .where(_eq(_entities.namespaceId, ns.id))
    .groupBy(_entities.id)
    .orderBy(_desc(_count(_mentions.id)))
    .limit(30);
  return [
    `You are Marrow, a research assistant for the namespace "${ns.name}"${ns.description ? ` — ${ns.description}` : ""}: a corpus of videos and captured text. You answer by RETRIEVING from it, never from memory alone.

Rules:
- Always call search first (several focused queries beat one broad one); use get_context to read around a hit before relying on it; use get_video for an item's article/references; use view_frame to look at a slide or chart; use lookup_entity for everything the corpus says about a paper/tool/person.
- Cite every claim as a markdown link in exactly this form: [Title @ MM:SS](/items/ITEM_ID?t=SECONDS), using item_id, t_start and the timestamp from the tool results. Text items (posts, newsletters, papers) have no timestamps: cite them as [Title](/items/ITEM_ID). Cross-item questions must cite at least two different items when the corpus has them.
- Say plainly when the corpus does not cover something. Use markdown; be concrete and concise.`,
    ns.summary ? `CORPUS SUMMARY:\n${ns.summary}` : "CORPUS SUMMARY: (not generated yet — rely on search)",
    ents.length ? `ENTITY INDEX (top by mentions):\n${ents.map((e) => `- ${e.name} (${e.kind}, ${Number(e.n)} mentions)`).join("\n")}` : "",
    ready.length ? `ITEMS:\n${ready.map((i) => `- ${i.id} — ${i.title}${i.channel ? ` (${i.channel})` : ""}`).join("\n")}` : "ITEMS: none yet",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function namespaceChatTools(deps: NamespaceChatDeps, ns: Namespace) {
  const { db, storage, config } = deps;
  const searchDeps: SearchDeps = { db, config, embedQuery: deps.embedQuery, rerank: deps.rerank };
  return {
    search: tool({
      description: "Hybrid search over the namespace. Returns segments with item_id, title, t_start, a timestamp, an internal link to cite, the text, and on-screen captions.",
      inputSchema: z.object({ query: z.string(), k: z.number().int().min(1).max(20).default(8), source_type: z.string().optional() }),
      execute: async ({ query, k, source_type }) => {
        const r = await search(searchDeps, { namespace: ns.id, query, k, sourceType: source_type });
        return r.hits.map((h) => ({
          segment_id: h.segment_id,
          item_id: h.item_id,
          title: h.title,
          t_start: h.t_start,
          timestamp: h.t_start === null ? null : fmtTs(h.t_start),
          link: `/items/${h.item_id}${h.t_start === null ? "" : `?t=${Math.floor(h.t_start)}`}`,
          text: h.text,
          frame_captions: h.frame_captions,
        }));
      },
    }),
    get_context: tool({
      description: "Transcript around a segment (±window_s seconds) so you can read the full argument.",
      inputSchema: z.object({ segment_id: z.string(), window_s: z.number().min(0).max(1800).default(120) }),
      execute: async ({ segment_id, window_s }) => (await getContext({ db, storage }, segment_id, window_s)) ?? { error: "segment not found" },
    }),
    get_video: tool({
      description: "An item's article (summary, takeaways, sections), chapters, references and claims — no transcript.",
      inputSchema: z.object({ video_id: z.string() }),
      execute: async ({ video_id }) => {
        const doc = await getDocument(storage, video_id);
        if (!doc) return { error: "no document" };
        const p = presentDocument(doc, { transcript: "none" });
        return { ...p, frames: undefined, frame_count: doc.frames.length };
      },
    }),
    view_frame: tool({
      description: "Load the keyframe image for a segment id (seg_…) or frame id (frm_…) to see what was on screen.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }): Promise<ViewFrameOutput> => {
        const f = await getFrame({ db, storage }, id);
        if (!f) return { error: `no frame for ${id}` };
        return { frame_id: f.frame.id, t: f.frame.t, timestamp: fmtTs(f.frame.t), caption: f.frame.caption, ocr_text: f.frame.ocrText, image_base64: Buffer.from(f.data).toString("base64") };
      },
      toModelOutput: ({ output }) => viewFrameModelOutput(output),
    }),
    lookup_entity: tool({
      description: "Everything the corpus says about a paper, tool, repo, person or technique: mentions with timestamps and claims grouped by stance.",
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        const r = await lookupEntity(db, { namespace: ns.id, name });
        if (!r.result) return { found: false, suggestions: r.suggestions };
        const { entity, mentions, stances, items } = r.result;
        return {
          found: true,
          entity: { name: entity.name, kind: entity.kind, url: entity.url, aliases: entity.aliases },
          items,
          stances,
          mentions: mentions.slice(0, 40).map((m) => ({ item_id: m.item_id, title: m.title, t: m.t, timestamp: m.t === null ? null : fmtTs(m.t), link: `/items/${m.item_id}${m.t === null ? "" : `?t=${Math.floor(m.t)}`}`, quote: m.quote, claim: m.claim_text, stance: m.stance })),
        };
      },
    }),
  };
}

export async function streamNamespaceChat(deps: NamespaceChatDeps, input: { namespace: Namespace; messages: UIMessage[]; userId?: string | null }): Promise<Response> {
  const { config } = deps;
  const model = deps.model ?? createOpenAI({ apiKey: config.OPENAI_API_KEY })(config.LLM_MODEL_CHAT);
  const tools = namespaceChatTools(deps, input.namespace);
  const result = streamText({
    model,
    system: await buildNamespaceChatSystem(deps.db, input.namespace),
    messages: await convertToModelMessages(input.messages, { tools }),
    tools,
    stopWhen: stepCountIs(10),
    providerOptions: { openai: { reasoningEffort: "low", textVerbosity: "medium", promptCacheKey: `marrow:ns:${input.namespace.id}` } },
    onFinish: async ({ totalUsage }) => {
      await recordChatUsage(deps.db, { namespaceId: input.namespace.id, userId: input.userId ?? null, model: config.LLM_MODEL_CHAT, usage: totalUsage, source: "namespace_chat" }).catch(() => undefined);
    },
  });
  return result.toUIMessageStreamResponse();
}
