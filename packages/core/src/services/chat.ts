import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, type UIMessage, convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import type { VideoDocument } from "../document.ts";
import { frameLines, referenceLines, transcriptContext } from "../pipeline/context.ts";
import type { Storage } from "../storage/index.ts";
import { fmtTs } from "../timefmt.ts";

/**
 * PRD §6.1 per-video chat. The system prompt is a STATIC prefix (instructions + full "[MM:SS] text" transcript +
 * metadata/chapters + keyframes as text + references) so the provider's prompt cache hits on every turn; anything
 * dynamic (playback position) is appended to the latest user message instead.
 */
export function buildVideoChatSystem(doc: VideoDocument): string {
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

export type VideoChatInput = { doc: VideoDocument; messages: UIMessage[]; playbackT?: number | null };

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
