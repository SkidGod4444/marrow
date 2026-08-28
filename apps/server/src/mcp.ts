import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addSource, answerReview, createCapture, createIngest, dueReviews, exportItemMarkdown, exportItemText, exportNamespaceMarkdown, getContext, getDocument, getFrame, getItem, getJobStatus, getNamespace, getNamespaceGraph, listExpressions, listInbox, listItems, listNamespaces, listSources, lookupEntity, pollAllSources, pollSource, presentDocument, reviewSummary, saveExpression, SOURCE_TYPES,
} from "@marrow/core";
import { type ServerDeps, captureDeps, pollDeps, runSearch } from "./deps.ts";
import { type Principal, can, hasScope, instancePrincipal, resolvePrincipal, scopeOf } from "./principal.ts";

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }] });
const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true as const });
type Extra = { requestInfo?: { headers?: Record<string, string | string[] | undefined> } };

/**
 * PRD §8 — the MCP skin. Same functions as the REST routes; this file only maps tool arguments to services.
 * Transports: stdio (`mcp-stdio.ts`) and Streamable HTTP (`/mcp` in `app.ts`).
 */
export function createMcpServer(deps: ServerDeps): McpServer {
  const server = new McpServer({ name: "marrow", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const principalDeps = { db: deps.db, auth: deps.auth, instanceKey: deps.config.MARROW_API_KEY, authOff: deps.config.MARROW_AUTH === "off" };

  /** Over HTTP the caller is the API key on the request; over stdio it is the fixed principal from the entrypoint. */
  const who = async (extra: Extra): Promise<Principal | null> => {
    const raw = extra.requestInfo?.headers;
    if (!raw) return deps.mcpPrincipal ?? (!deps.auth || principalDeps.authOff ? instancePrincipal(deps.db, null) : null);
    const headers = new Headers();
    for (const [k, v] of Object.entries(raw)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
    return resolvePrincipal(principalDeps, headers);
  };
  const NO_AUTH = "send a valid API key (x-api-key) — create one on the web app's API keys page";
  const NO_ORG = "this key is not bound to a workspace";
  const denied = (what: string) => fail(`your role in this workspace can't ${what}`);
  const ownItem = async (p: Principal, id: string) => {
    const item = await getItem(deps.db, id);
    if (!item) return null;
    return (await getNamespace(deps.db, item.namespaceId, scopeOf(p))) ? item : null;
  };

  server.registerTool(
    "list_namespaces",
    { title: "List namespaces", description: "Topic-scoped knowledge bases: name, description, item counts, and the auto-generated corpus summary." },
    async (extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      return text({ workspace: p.organizationSlug, role: p.role, namespaces: (await listNamespaces(deps.db, scopeOf(p))).map((n) => ({ id: n.id, name: n.name, description: n.description, summary: n.summary, items: n.itemCount, ready: n.readyCount, flags: n.flags })) });
    },
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
    async ({ namespace, query, k, source_type }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      try {
        return text(await runSearch(deps, { namespace, organizationId: scopeOf(p), query, k, sourceType: source_type }));
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
    async ({ segment_id, window_s }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      const ctx = await getContext(deps, segment_id, window_s);
      return ctx && (await ownItem(p, ctx.item_id)) ? text(ctx) : fail(`segment ${segment_id} not found`);
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
    async ({ video_id, transcript, max_entries, include_words }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!(await ownItem(p, video_id))) return fail(`no document for ${video_id}`);
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
    async ({ id }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      const f = await getFrame(deps, id);
      if (!f || !(await ownItem(p, f.frame.itemId))) return fail(`no frame for ${id}`);
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
    async ({ namespace, name }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      try {
        const r = await lookupEntity(deps.db, { namespace, organizationId: scopeOf(p), name });
        return r.result ? text(r.result) : text({ found: false, suggestions: r.suggestions });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "get_graph",
    {
      title: "Knowledge graph",
      description: "The namespace as a graph: item nodes (videos) and entity nodes (papers, tools, repos, people, techniques), with item–entity edges weighted by mention count and carrying the stance mix (supports/opposes/neutral) and the first timestamp. Use it to see which sources connect, which entities are contested, and where to look next.",
      inputSchema: { namespace: z.string(), max_entities: z.number().int().min(1).max(1000).default(150) },
    },
    async ({ namespace, max_entities }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      try {
        return text(await getNamespaceGraph(deps.db, namespace, { maxEntities: max_entities, organizationId: scopeOf(p) }));
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
    async ({ namespace, status }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      const ns = await getNamespace(deps.db, namespace, scopeOf(p));
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
    async ({ namespace, url, force }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      if (!can(p, "item", "add")) return denied("add items");
      try {
        const res = await createIngest(deps.db, { namespace, organizationId: scopeOf(p), url, force });
        if (!res.reused || res.job.state !== "done") await deps.queue.enqueue(res.job.id);
        return text({ job_id: res.job.id, item_id: res.item.id, reused: res.reused, state: res.job.state });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "capture",
    {
      title: "Capture text",
      description:
        "Save a web page, paper (arXiv/PDF), or pasted text into a namespace as a searchable text document (PRD §7). Pass a url (fetched server-side, no login) and/or the text itself; social posts (X, LinkedIn) need the text. YouTube links found inside are returned as linked_videos (queued automatically when the namespace has auto_ingest_links).",
      inputSchema: {
        namespace: z.string(),
        url: z.string().optional(),
        text: z.string().optional(),
        title: z.string().optional(),
        author: z.string().optional(),
        note: z.string().optional().describe("Why you saved it — shown with the item"),
        source_type: z.enum(["captured_post", "newsletter", "paper"]).optional(),
      },
    },
    async (input, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      if (!can(p, "item", "add")) return denied("add items");
      try {
        const res = await createCapture(captureDeps(deps), { ...input, organizationId: scopeOf(p) });
        return text({ job_id: res.job.id, item_id: res.item.id, reused: res.reused, state: res.job.state, source_type: res.item.sourceType, title: res.item.title, linked_videos: res.linked_videos, queued_videos: res.queued_videos });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "subscribe",
    {
      title: "Subscribe to a playlist, channel or feed",
      description: "Add a YouTube playlist/channel or an RSS/Atom feed (podcast or blog) to a namespace. It is polled on a schedule: new uploads/episodes are ingested automatically, blog entries are captured as text; the first poll runs immediately.",
      inputSchema: { namespace: z.string(), url: z.string(), title: z.string().optional(), kind: z.enum(["playlist", "channel", "rss"]).optional() },
    },
    async ({ namespace, url, title, kind }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      if (!can(p, "source", "follow")) return denied("follow sources");
      try {
        const res = await addSource(deps.db, { namespace, organizationId: scopeOf(p), url, title, kind });
        const poll = await pollSource(pollDeps(deps), res.source);
        return text({ source: res.source, created: res.created, poll });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "list_sources",
    { title: "List subscriptions", description: "Subscribed playlists/channels with last-checked time and last error.", inputSchema: { namespace: z.string().optional() } },
    async ({ namespace }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      const ns = namespace ? await getNamespace(deps.db, namespace, scopeOf(p)) : null;
      if (namespace && !ns) return fail(`namespace "${namespace}" not found`);
      const ids = new Set((await listNamespaces(deps.db, scopeOf(p))).map((n) => n.id));
      return text({ sources: (await listSources(deps.db, ns?.id)).filter((s) => ids.has(s.namespaceId)) });
    },
  );

  server.registerTool(
    "poll_sources",
    { title: "Poll subscriptions now", description: "Check every subscription (or one namespace's) for new uploads and queue them.", inputSchema: { namespace: z.string().optional() } },
    async ({ namespace }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      if (!can(p, "source", "poll")) return denied("poll sources");
      const ns = namespace ? await getNamespace(deps.db, namespace, scopeOf(p)) : null;
      if (namespace && !ns) return fail(`namespace "${namespace}" not found`);
      if (!ns && !scopeOf(p)) return text({ results: await pollAllSources(pollDeps(deps)) });
      const targets = ns ? [ns] : await listNamespaces(deps.db, scopeOf(p));
      const results = [];
      for (const t of targets) results.push(...(await pollAllSources(pollDeps(deps), t.id)));
      return text({ results });
    },
  );

  server.registerTool(
    "inbox",
    { title: "Watch inbox", description: "Ready items you haven't skipped, newest first, each with its summary and novelty verdict; plus items still ingesting.", inputSchema: { namespace: z.string().optional() } },
    async ({ namespace }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!hasScope(p)) return fail(NO_ORG);
      try {
        const r = await listInbox(deps.db, { organizationId: scopeOf(p), namespace });
        return text({
          entries: r.entries.map((e) => ({ id: e.id, namespace: e.namespace.name, title: e.title, channel: e.channel, duration_s: e.durationS, summary: e.summary, novelty: e.novelty?.verdict ?? null, created_at: e.createdAt })),
          pending: r.pending.map((e) => ({ id: e.id, namespace: e.namespace.name, title: e.title || e.sourceUrl, status: e.status })),
        });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  // ---- Language mode + review queue (PRD §6.3) ----
  server.registerTool(
    "list_expressions",
    { title: "Expressions to learn", description: "Language mode: the expressions (idioms, phrasal verbs, collocations, slang) mined from an item, each with meaning, exact time span, clip URL and deep link. Only items in namespaces flagged language_learning have them.", inputSchema: { item_id: z.string() } },
    async ({ item_id }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!(await ownItem(p, item_id))) return fail(`item ${item_id} not found`);
      const r = await listExpressions({ db: deps.db, storage: deps.storage }, item_id, p.via === "instance" ? undefined : p.userId);
      return r ? text(r) : fail(`item ${item_id} not found`);
    },
  );
  server.registerTool(
    "save_expression",
    { title: "Learn an expression", description: "Put an expression in the review queue: it comes back as a recall prompt after 2 days, then 7, then 30.", inputSchema: { item_id: z.string(), n: z.number().int().min(0).describe("Index from list_expressions") } },
    async ({ item_id, n }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (!(await ownItem(p, item_id))) return fail(`item ${item_id} not found`);
      try {
        return text({ review: await saveExpression({ db: deps.db, storage: deps.storage }, item_id, n, p.via === "instance" ? undefined : p.userId) });
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );
  server.registerTool(
    "review_queue",
    { title: "Review queue", description: "Expressions due for recall now (oldest first) — quiz the owner: show the expression, ask for the meaning, then reveal the explanation and answer_review.", inputSchema: {} },
    async (extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      const uid = p.via === "instance" ? undefined : p.userId;
      return text({ summary: await reviewSummary(deps.db, new Date(), uid), due: await dueReviews(deps.db, new Date(), uid) });
    },
  );
  server.registerTool(
    "answer_review",
    { title: "Answer a review", description: "Record the outcome of a recall prompt: got_it advances the interval (2d → 7d → 30d), again restarts at 2d.", inputSchema: { review_id: z.string(), result: z.enum(["got_it", "again"]) } },
    async ({ review_id, result }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      const r = await answerReview(deps.db, review_id, result, new Date(), p.via === "instance" ? undefined : p.userId);
      return r ? text({ review: r }) : fail(`review ${review_id} not found`);
    },
  );

  server.registerTool(
    "job_status",
    { title: "Job status", description: "Pipeline stage progress, per-stage cost, and errors for an ingest job.", inputSchema: { job_id: z.string() } },
    async ({ job_id }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      const s = await getJobStatus(deps.db, job_id);
      if (s && !(await ownItem(p, s.item.id))) return fail(`job ${job_id} not found`);
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
        transcript: z.boolean().default(false).describe("Include the full timestamped transcript as speaker-labelled dialogue (video_id only)"),
        format: z.enum(["md", "txt"]).default("md").describe("Markdown with links, or plain text"),
      },
    },
    async ({ video_id, namespace, transcript, format }, extra) => {
      const p = await who(extra);
      if (!p) return fail(NO_AUTH);
      if (video_id) {
        if (!(await ownItem(p, video_id))) return fail(`no document for ${video_id}`);
        const out = format === "txt" ? await exportItemText(deps, video_id, { transcript }) : await exportItemMarkdown(deps, video_id, { transcript });
        return out ? text(out) : fail(`no document for ${video_id}`);
      }
      if (namespace) {
        if (!hasScope(p)) return fail(NO_ORG);
        const md = await exportNamespaceMarkdown(deps, namespace, scopeOf(p));
        return md ? text(md) : fail(`namespace "${namespace}" not found`);
      }
      return fail("pass video_id or namespace");
    },
  );

  return server;
}

const INSTRUCTIONS = `Marrow is a research knowledge base built from long-form videos (talks, lectures, podcasts) and captured text, organised into namespaces inside a workspace. Your API key is bound to one workspace and carries your role there (owner/admin/member/viewer).
Workflow: list_namespaces → search(namespace, query) → get_context / get_frame / get_video_document to read deeper → lookup_entity for everything the corpus says about a paper, tool, or person.
Always cite as "title @ MM:SS" with the deep_link returned by search. Use ingest + job_status to add new videos.`;
