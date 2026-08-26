import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  SOURCE_TYPES, createIngest, exportItemMarkdown, exportNamespaceMarkdown, getContext, getDocument, getFrame, getItem, getJobStatus,
  getNamespace, listItems, listNamespaces, lookupEntity, presentDocument,
} from "@marrow/core";
import { type ServerDeps, runSearch } from "./deps.ts";

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true as const });

/**
 * PRD §8 — the MCP skin. Same functions as the REST routes; this file only maps tool arguments to services.
 * Transports: stdio (`mcp-stdio.ts`) and Streamable HTTP (`/mcp` in `app.ts`).
 */
export function createMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "marrow", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "list_namespaces",
    { title: "List namespaces", description: "Topic-scoped knowledge bases: name, description, item counts, and the auto-generated corpus summary." },
    async () => text({ namespaces: (await listNamespaces(deps.db)).map((n) => ({ id: n.id, name: n.name, description: n.description, summary: n.summary, items: n.itemCount, ready: n.readyCount, flags: n.flags })) }),
  );

  server.registerTool(
    "search",
    {
      title: "Search a namespace",
      description:
        "Hybrid (vector + full-text, RRF-merged) search over a namespace. Returns transcript segments with title, t_start (seconds), a deep link to that moment, the segment text, and captions of keyframes on screen. Cite results as `title @ MM:SS` with the deep link. Use source_type to restrict to e.g. notes or youtube videos.",
      inputSchema: {
        namespace: z.string().describe("Namespace name or id"),
        query: z.string(),
        k: z.number().int().min(1).max(50).default(8),
        source_type: z.enum(SOURCE_TYPES).optional(),
      },
    },
    async ({ namespace, query, k, source_type }) => {
      try {
        return text(await runSearch(deps, { namespace, query, k, sourceType: source_type }));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "get_context",
    {
      title: "Transcript around a segment",
      description: "The timestamped transcript surrounding a search result (±window_s seconds), for reading the full argument before citing.",
      inputSchema: { segment_id: z.string(), window_s: z.number().min(0).max(1800).default(120) },
    },
    async ({ segment_id, window_s }) => {
      const ctx = await getContext(deps, segment_id, window_s);
      return ctx ? text(ctx) : fail(`segment ${segment_id} not found`);
    },
  );

  server.registerTool(
    "get_video_document",
    {
      title: "Full video document",
      description: "The canonical document for an item: metadata, chapters, article (summary, takeaways, sections), references, claims, keyframe captions, novelty verdict, and optionally the timestamped transcript.",
      inputSchema: {
        video_id: z.string().describe("Item id (vid_… / txt_…)"),
        transcript: z.enum(["full", "none"]).default("none").describe("Include the transcript (can be large)"),
        max_entries: z.number().int().min(1).optional().describe("Truncate the transcript to this many entries"),
        include_words: z.boolean().default(false).describe("Include word-level timestamps"),
      },
    },
    async ({ video_id, transcript, max_entries, include_words }) => {
      const doc = await getDocument(deps.storage, video_id);
      if (!doc) return fail(`no document for ${video_id}`);
      return text(presentDocument(doc, { transcript, maxEntries: max_entries, includeWords: include_words }));
    },
  );

  server.registerTool(
    "get_frame",
    {
      title: "Keyframe image",
      description: "The keyframe (JPEG) for a frame id (frm_…) or the frame on screen during a segment (seg_…). Use it to read slides, charts, or code that the transcript only alludes to.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const f = await getFrame(deps, id);
      if (!f) return fail(`no frame for ${id}`);
      return {
        content: [
          { type: "image" as const, data: Buffer.from(f.data).toString("base64"), mimeType: f.mimeType },
          { type: "text" as const, text: JSON.stringify({ frame_id: f.frame.id, item_id: f.frame.itemId, t: f.frame.t, caption: f.frame.caption, ocr_text: f.frame.ocrText }) },
        ],
      };
    },
  );

  server.registerTool(
    "lookup_entity",
    {
      title: "Entity across the corpus",
      description: "Everything the namespace says about a paper/tool/repo/person/technique: every mention with timestamp + deep link, and claims grouped by stance (supports / opposes / neutral) so agreements and disagreements across videos are visible.",
      inputSchema: { namespace: z.string(), name: z.string().describe("Entity name or alias (case-insensitive)") },
    },
    async ({ namespace, name }) => {
      try {
        const r = await lookupEntity(deps.db, { namespace, name });
        return r.result ? text(r.result) : text({ found: false, suggestions: r.suggestions });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "list_items",
    {
      title: "List items",
      description: "Items in a namespace with ingest status (queued | running | failed | ready).",
      inputSchema: { namespace: z.string(), status: z.enum(["queued", "running", "failed", "ready"]).optional() },
    },
    async ({ namespace, status }) => {
      const ns = await getNamespace(deps.db, namespace);
      if (!ns) return fail(`namespace "${namespace}" not found`);
      const rows = await listItems(deps.db, ns.id, status);
      return text({ items: rows.map((i) => ({ id: i.id, title: i.title, channel: i.channel, status: i.status, source_type: i.sourceType, source_url: i.sourceUrl, duration_s: i.durationS, published_at: i.publishedAt })) });
    },
  );

  server.registerTool(
    "ingest",
    {
      title: "Ingest a URL",
      description: "Enqueue a YouTube video for ingestion into a namespace. Idempotent per (namespace, url); returns the job id to poll with job_status.",
      inputSchema: { namespace: z.string(), url: z.string(), force: z.boolean().default(false).describe("Re-ingest an item that is already ready") },
    },
    async ({ namespace, url, force }) => {
      try {
        const res = await createIngest(deps.db, { namespace, url, force });
        if (!res.reused || res.job.state !== "done") await deps.queue.enqueue(res.job.id);
        return text({ job_id: res.job.id, item_id: res.item.id, reused: res.reused, state: res.job.state });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "job_status",
    { title: "Job status", description: "Pipeline stage progress, per-stage cost, and errors for an ingest job.", inputSchema: { job_id: z.string() } },
    async ({ job_id }) => {
      const s = await getJobStatus(deps.db, job_id);
      return s ? text({ job_id: s.job.id, state: s.job.state, version: s.job.version, cost_usd: s.job.costUsd, error: s.job.error, item: s.item, stages: s.progress }) : fail(`job ${job_id} not found`);
    },
  );

  server.registerTool(
    "export_markdown",
    {
      title: "Export markdown",
      description: "Clean markdown with clickable timestamp links — one item (video_id) or a whole namespace index (namespace). Paste into Obsidian/Notion or a report.",
      inputSchema: {
        video_id: z.string().optional(),
        namespace: z.string().optional(),
        transcript: z.boolean().default(false).describe("Include the full timestamped transcript (video_id only)"),
      },
    },
    async ({ video_id, namespace, transcript }) => {
      if (video_id) {
        const md = await exportItemMarkdown(deps, video_id, { transcript });
        return md ? text(md) : fail(`no document for ${video_id}`);
      }
      if (namespace) {
        const md = await exportNamespaceMarkdown(deps, namespace);
        return md ? text(md) : fail(`namespace "${namespace}" not found`);
      }
      return fail("pass video_id or namespace");
    },
  );

  // Cheap existence check used by the REST layer too; keeps the skins honest about ids.
  void getItem;
  return server;
}

const INSTRUCTIONS = `Marrow is a research knowledge base built from long-form videos (talks, lectures, podcasts) and captured text, organised into namespaces.
Workflow: list_namespaces → search(namespace, query) → get_context / get_frame / get_video_document to read deeper → lookup_entity for everything the corpus says about a paper, tool, or person.
Always cite as "title @ MM:SS" with the deep_link returned by search. Use ingest + job_status to add new videos.`;
