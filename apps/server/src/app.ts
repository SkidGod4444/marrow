import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { UIMessage } from "ai";
import {
  SOURCE_TYPES, type SourceKind, addSource, archiveItem, createIngest, createNamespace, exportItemMarkdown, exportItemText, exportNamespaceMarkdown, getContext, getDocument,
  getFrame, getItem, getJobStatus, getNamespace, getNamespaceGraph, listEntities, listInbox, listItems, listNamespaces, listSources, logEvent, lookupEntity,
  pollAllSources, pollSource, presentDocument, refreshNamespaceSummary, removeSource, streamNamespaceChat, streamVideoChat,
} from "@marrow/core";
import { type ServerDeps, runSearch } from "./deps.ts";
import { createMcpServer } from "./mcp.ts";

export type AppDeps = ServerDeps;

/** REST skin over the service layer (PRD §8) + the MCP Streamable HTTP endpoint at /mcp. Thin: argument mapping only. */
export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Single-owner API key (PRD §8). When MARROW_API_KEY is unset (local dev) everything is open.
  app.use("*", async (c, next) => {
    const key = deps.config.MARROW_API_KEY;
    if (key) {
      const got = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (got !== key) return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  // ---- MCP (Streamable HTTP, stateless) ----
  const mcp = createMcpServer(deps);
  const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
  app.all("/mcp", async (c) => {
    if (!mcp.isConnected()) await mcp.connect(transport);
    return transport.handleRequest(c);
  });

  // ---- Namespaces ----
  app.get("/namespaces", async (c) => c.json({ namespaces: await listNamespaces(deps.db) }));

  app.post("/namespaces", async (c) => {
    const body = await c.req.json<{ name: string; description?: string; flags?: Record<string, boolean> }>();
    try {
      return c.json({ namespace: await createNamespace(deps.db, body) }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/namespaces/:ref/entities", async (c) => {
    const ns = await getNamespace(deps.db, c.req.param("ref"));
    if (!ns) return c.json({ error: "namespace not found" }, 404);
    return c.json({ entities: await listEntities(deps.db, ns.id) });
  });

  app.post("/namespaces/:ref/summary", async (c) => {
    const ns = await getNamespace(deps.db, c.req.param("ref"));
    if (!ns) return c.json({ error: "namespace not found" }, 404);
    return c.json(await refreshNamespaceSummary({ db: deps.db, generate: deps.generate }, ns.id));
  });

  // ---- Per-namespace chat (PRD §6.1) ----
  app.post("/namespaces/:ref/chat", async (c) => {
    const ns = await getNamespace(deps.db, c.req.param("ref"));
    if (!ns) return c.json({ error: "namespace not found" }, 404);
    const body = await c.req.json<{ messages: UIMessage[] }>();
    if (!Array.isArray(body.messages) || !body.messages.length) return c.json({ error: "messages are required" }, 400);
    return streamNamespaceChat({ config: deps.config, storage: deps.storage, db: deps.db, model: deps.chatModel, embedQuery: deps.embedQuery, rerank: deps.rerank }, { namespace: ns, messages: body.messages });
  });

  // ---- Subscriptions (PRD §6.4) ----
  app.get("/sources", async (c) => {
    const ref = c.req.query("namespace");
    const ns = ref ? await getNamespace(deps.db, ref) : null;
    if (ref && !ns) return c.json({ error: "namespace not found" }, 404);
    return c.json({ sources: await listSources(deps.db, ns?.id) });
  });

  app.post("/sources", async (c) => {
    const body = await c.req.json<{ namespace: string; url: string; kind?: SourceKind; title?: string; poll?: boolean }>();
    try {
      const res = await addSource(deps.db, body);
      const poll = body.poll === undefined ? true : body.poll;
      const polled = poll ? await pollSource({ db: deps.db, queue: deps.queue, listEntries: deps.listEntries }, res.source) : null;
      return c.json({ source: res.source, created: res.created, poll: polled }, res.created ? 201 : 200);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.delete("/sources/:id", async (c) => ((await removeSource(deps.db, c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "source not found" }, 404)));

  app.post("/sources/:id/poll", async (c) => {
    const [src] = (await listSources(deps.db)).filter((s) => s.id === c.req.param("id"));
    if (!src) return c.json({ error: "source not found" }, 404);
    return c.json(await pollSource({ db: deps.db, queue: deps.queue, listEntries: deps.listEntries }, src));
  });

  app.post("/namespaces/:ref/poll", async (c) => {
    const ns = await getNamespace(deps.db, c.req.param("ref"));
    if (!ns) return c.json({ error: "namespace not found" }, 404);
    return c.json({ results: await pollAllSources({ db: deps.db, queue: deps.queue, listEntries: deps.listEntries }, ns.id) });
  });

  // ---- Watch inbox (PRD §6.4) ----
  app.get("/inbox", async (c) => {
    try {
      return c.json(await listInbox(deps.db, { namespace: c.req.query("namespace"), includeArchived: c.req.query("archived") === "1" }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.post("/items/:id/archive", async (c) => {
    const body = await c.req.json<{ archived?: boolean }>().catch(() => ({}) as { archived?: boolean });
    const row = await archiveItem(deps.db, c.req.param("id"), body.archived ?? true);
    return row ? c.json({ item: row }) : c.json({ error: "item not found" }, 404);
  });

  app.get("/namespaces/:ref/graph", async (c) => {
    try {
      return c.json(await getNamespaceGraph(deps.db, c.req.param("ref"), { maxEntities: c.req.query("max_entities") ? Number(c.req.query("max_entities")) : undefined }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.get("/namespaces/:ref/export.md", async (c) => {
    const md = await exportNamespaceMarkdown(deps, c.req.param("ref"));
    return md ? c.text(md, 200, { "content-type": "text/markdown; charset=utf-8" }) : c.json({ error: "namespace not found" }, 404);
  });

  // ---- Retrieval ----
  app.get("/search", async (c) => {
    const namespace = c.req.query("namespace");
    const query = c.req.query("q") ?? c.req.query("query");
    if (!namespace || !query) return c.json({ error: "namespace and q are required" }, 400);
    const sourceType = c.req.query("source_type");
    if (sourceType && !(SOURCE_TYPES as readonly string[]).includes(sourceType)) return c.json({ error: `invalid source_type` }, 400);
    try {
      return c.json(await runSearch(deps, { namespace, query, k: Number(c.req.query("k") ?? 8), sourceType }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/segments/:id/context", async (c) => {
    const ctx = await getContext(deps, c.req.param("id"), Number(c.req.query("window_s") ?? 120));
    return ctx ? c.json(ctx) : c.json({ error: "segment not found" }, 404);
  });

  app.get("/frames/:id", async (c) => {
    const f = await getFrame(deps, c.req.param("id"));
    if (!f) return c.json({ error: "frame not found" }, 404);
    return new Response(Buffer.from(f.data), { status: 200, headers: { "content-type": f.mimeType, "cache-control": "private, max-age=3600", "x-frame-t": String(f.frame.t) } });
  });

  app.get("/entities", async (c) => {
    const namespace = c.req.query("namespace");
    const name = c.req.query("name");
    if (!namespace || !name) return c.json({ error: "namespace and name are required" }, 400);
    try {
      const r = await lookupEntity(deps.db, { namespace, name });
      return r.result ? c.json(r.result) : c.json({ found: false, suggestions: r.suggestions }, 404);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // ---- Items ----
  app.get("/items", async (c) => {
    const ref = c.req.query("namespace");
    if (!ref) return c.json({ error: "namespace is required" }, 400);
    const ns = await getNamespace(deps.db, ref);
    if (!ns) return c.json({ error: "namespace not found" }, 404);
    return c.json({ items: await listItems(deps.db, ns.id, c.req.query("status")) });
  });

  app.get("/items/:id", async (c) => {
    const item = await getItem(deps.db, c.req.param("id"));
    return item ? c.json({ item }) : c.json({ error: "item not found" }, 404);
  });

  app.get("/items/:id/document", async (c) => {
    const doc = await getDocument(deps.storage, c.req.param("id"));
    if (!doc) return c.json({ error: "document not found" }, 404);
    const transcript = c.req.query("transcript") === "none" ? "none" : "full";
    const maxEntries = c.req.query("max_entries") ? Number(c.req.query("max_entries")) : undefined;
    return c.json(presentDocument(doc, { transcript, maxEntries, includeWords: c.req.query("words") === "1" }));
  });

  app.get("/items/:id/export.md", async (c) => {
    const md = await exportItemMarkdown(deps, c.req.param("id"), { transcript: c.req.query("transcript") === "1" });
    return md ? c.text(md, 200, { "content-type": "text/markdown; charset=utf-8", "content-disposition": `inline; filename="${c.req.param("id")}.md"` }) : c.json({ error: "document not found" }, 404);
  });

  app.get("/items/:id/export.txt", async (c) => {
    const txt = await exportItemText(deps, c.req.param("id"), { transcript: c.req.query("transcript") !== "0" });
    return txt ? c.text(txt, 200, { "content-type": "text/plain; charset=utf-8", "content-disposition": `inline; filename="${c.req.param("id")}.txt"` }) : c.json({ error: "document not found" }, 404);
  });

  // ---- Per-video chat (PRD §6.1) — AI SDK UI-message stream for `useChat` ----
  app.post("/items/:id/chat", async (c) => {
    const id = c.req.param("id");
    const doc = await getDocument(deps.storage, id);
    if (!doc) return c.json({ error: "document not found" }, 404);
    const body = await c.req.json<{ messages: UIMessage[]; playback_t?: number | null }>();
    if (!Array.isArray(body.messages) || !body.messages.length) return c.json({ error: "messages are required" }, 400);
    await logEvent(deps.db, id, "chatted");
    return streamVideoChat({ config: deps.config, storage: deps.storage, db: deps.db, model: deps.chatModel }, { doc, messages: body.messages, playbackT: body.playback_t ?? null });
  });

  // ---- Activity events (PRD §11) ----
  app.post("/items/:id/events", async (c) => {
    const item = await getItem(deps.db, c.req.param("id"));
    if (!item) return c.json({ error: "item not found" }, 404);
    const { kind } = await c.req.json<{ kind: string }>();
    if (!["read", "chatted", "skipped", "expression_saved"].includes(kind)) return c.json({ error: "invalid kind" }, 400);
    await logEvent(deps.db, item.id, kind as "read");
    return c.json({ ok: true });
  });

  // ---- Ingestion ----
  app.post("/ingest", async (c) => {
    const body = await c.req.json<{ namespace: string; url: string; force?: boolean }>();
    try {
      const res = await createIngest(deps.db, body);
      if (!res.reused || res.job.state !== "done") await deps.queue.enqueue(res.job.id);
      return c.json({ job_id: res.job.id, item_id: res.item.id, reused: res.reused, state: res.job.state }, res.reused ? 200 : 202);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/jobs/:id", async (c) => {
    const status = await getJobStatus(deps.db, c.req.param("id"));
    return status ? c.json(status) : c.json({ error: "job not found" }, 404);
  });

  return app;
}
