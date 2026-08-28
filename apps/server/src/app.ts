import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { UIMessage } from "ai";
import { timingSafeEqual } from "node:crypto";
import {
  addSource, answerReview, archiveItem, audioKey, captureEmail, clipKey, createCapture, createIngest, createNamespace, exportItemMarkdown, exportItemText, exportNamespaceMarkdown, getContext, getDocument, getFrame, getItem, getJobStatus, getNamespace, getNamespaceGraph, hasOwner, listEntities, listExpressions, listInbox, listItems, listNamespaces, listSources, logEvent, lookupEntity, normalizeInboundEmail, pollAllSources, pollSource, presentDocument, refreshNamespaceSummary, removeSource, reviewQueue, reviewSummary, saveExpression, SOURCE_TYPES, streamNamespaceChat, streamVideoChat, type CaptureInput, type SourceKind, unsaveExpression, updateNamespaceFlags,
} from "@marrow/core";
import { type ServerDeps, captureDeps, pollDeps, runSearch } from "./deps.ts";
import { createMcpServer } from "./mcp.ts";

export type AppDeps = ServerDeps;

/** REST skin over the service layer (PRD §8) + the MCP Streamable HTTP endpoint at /mcp. Thin: argument mapping only. */
export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true }));

  // Single-owner API key (PRD §8). When MARROW_API_KEY is unset (local dev) everything is open.
  // The inbound-email webhook authenticates with its own token in the path (mail providers can't send our header).
  app.use("*", async (c, next) => {
    const key = deps.config.MARROW_API_KEY;
    const open = c.req.path.startsWith("/inbound/email/") || c.req.path.startsWith("/api/auth/") || c.req.path === "/auth/status";
    if (key && !open) {
      const got = c.req.header("x-api-key") ?? c.req.header("authorization")?.replace(/^Bearer\s+/i, "");
      if (got !== key) return c.json({ error: "unauthorized" }, 401);
    }
    await next();
  });

  // ---- Owner login (Better Auth) — proxied by the web app; public by design, sign-up closes after the first account ----
  if (deps.auth) {
    const auth = deps.auth;
    app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  }
  app.get("/auth/status", async (c) => c.json({ enabled: Boolean(deps.auth) && deps.config.MARROW_AUTH === "on", has_owner: deps.auth ? await hasOwner(deps.db) : false }));

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

  app.patch("/namespaces/:ref", async (c) => {
    const body = await c.req.json<{ flags?: Record<string, boolean> }>().catch(() => ({}) as { flags?: Record<string, boolean> });
    const ns = await updateNamespaceFlags(deps.db, c.req.param("ref"), body.flags ?? {});
    return ns ? c.json({ namespace: ns }) : c.json({ error: "namespace not found" }, 404);
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
      const polled = poll ? await pollSource(pollDeps(deps), res.source) : null;
      return c.json({ source: res.source, created: res.created, poll: polled }, res.created ? 201 : 200);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.delete("/sources/:id", async (c) => ((await removeSource(deps.db, c.req.param("id"))) ? c.json({ ok: true }) : c.json({ error: "source not found" }, 404)));

  app.post("/sources/:id/poll", async (c) => {
    const [src] = (await listSources(deps.db)).filter((s) => s.id === c.req.param("id"));
    if (!src) return c.json({ error: "source not found" }, 404);
    return c.json(await pollSource(pollDeps(deps), src));
  });

  app.post("/namespaces/:ref/poll", async (c) => {
    const ns = await getNamespace(deps.db, c.req.param("ref"));
    if (!ns) return c.json({ error: "namespace not found" }, 404);
    return c.json({ results: await pollAllSources(pollDeps(deps), ns.id) });
  });

  // ---- Capture (PRD §7) ----
  app.post("/capture", async (c) => {
    const body = await c.req.json<CaptureInput>().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "expected a JSON body {namespace, url?, text?, title?, author?, note?}" }, 400);
    try {
      const res = await createCapture(captureDeps(deps), body);
      return c.json(
        { job_id: res.job.id, item_id: res.item.id, reused: res.reused, state: res.job.state, source_type: res.item.sourceType, title: res.item.title, linked_videos: res.linked_videos, queued_videos: res.queued_videos },
        res.reused ? 200 : 202,
      );
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  // Inbound email webhook (STACK:inbound_email): the provider posts each mail here; token in the path, not the API key.
  app.post("/inbound/email/:token", async (c) => {
    const expected = deps.config.INBOUND_EMAIL_TOKEN;
    const got = c.req.param("token");
    const enc = new TextEncoder();
    if (!expected || got.length !== expected.length || !timingSafeEqual(enc.encode(got), enc.encode(expected))) return c.json({ error: "unauthorized" }, 401);
    const mail = normalizeInboundEmail(await c.req.json().catch(() => null));
    if (!mail) return c.json({ error: "unrecognised email payload" }, 400);
    try {
      const res = await captureEmail(captureDeps(deps), mail, { defaultNamespace: deps.config.INBOUND_EMAIL_NAMESPACE });
      return c.json({ ok: true, item_id: res.item.id, job_id: res.job.id, reused: res.reused }, res.reused ? 200 : 202);
    } catch (err) {
      // 2xx so the provider doesn't retry a mail we will never accept (no namespace, empty body); the reason is logged.
      console.warn(`[inbound email] dropped: ${(err as Error).message}`);
      return c.json({ ok: false, dropped: (err as Error).message }, 200);
    }
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

  app.get("/items/:id/audio", async (c) => {
    const item = await getItem(deps.db, c.req.param("id"));
    if (!item) return c.json({ error: "item not found" }, 404);
    const key = audioKey(item.id);
    if (!(await deps.storage.exists(key))) return c.json({ error: "no audio for this item" }, 404);
    const bytes = await deps.storage.get(key);
    const type = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 ? "audio/wav" : "audio/ogg"; // RIFF → WAV (fakes), else Opus/OGG
    const range = c.req.header("range");
    const m = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, bytes.byteLength - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), bytes.byteLength - 1) : bytes.byteLength - 1;
      if (start > end || start >= bytes.byteLength) return c.body(null, 416, { "content-range": `bytes */${bytes.byteLength}` });
      return c.body(bytes.slice(start, end + 1) as unknown as ArrayBuffer, 206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${bytes.byteLength}`, "content-length": String(end - start + 1), "cache-control": "private, max-age=3600" });
    }
    return c.body(bytes as unknown as ArrayBuffer, 200, { "content-type": type, "accept-ranges": "bytes", "content-length": String(bytes.byteLength), "cache-control": "private, max-age=3600" });
  });

  // ---- Language mode + review queue (PRD §6.3) ----
  app.get("/items/:id/expressions", async (c) => {
    const r = await listExpressions({ db: deps.db, storage: deps.storage }, c.req.param("id"));
    return r ? c.json(r) : c.json({ error: "item not found" }, 404);
  });

  app.post("/items/:id/expressions/:n/save", async (c) => {
    try {
      const review = await saveExpression({ db: deps.db, storage: deps.storage }, c.req.param("id"), Number(c.req.param("n")));
      return c.json({ review }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.delete("/items/:id/expressions/:n/save", async (c) => ((await unsaveExpression(deps.db, c.req.param("id"), Number(c.req.param("n")))) ? c.json({ ok: true }) : c.json({ error: "not saved" }, 404)));

  app.get("/items/:id/clips/:n", async (c) => {
    const key = clipKey(c.req.param("id"), Number(c.req.param("n")));
    if (!(await deps.storage.exists(key))) return c.json({ error: "clip not found" }, 404);
    const bytes = await deps.storage.get(key);
    const type = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 ? "audio/wav" : "audio/mp4"; // RIFF → WAV (fakes), else AAC
    return c.body(bytes as unknown as ArrayBuffer, 200, { "content-type": type, "content-length": String(bytes.byteLength), "cache-control": "private, max-age=86400" });
  });

  const nowOf = (raw: string | undefined) => (raw && !Number.isNaN(new Date(raw).getTime()) ? new Date(raw) : new Date());
  app.get("/reviews", async (c) => c.json(await reviewQueue(deps.db, { now: nowOf(c.req.query("now")) })));
  app.get("/reviews/summary", async (c) => c.json(await reviewSummary(deps.db, nowOf(c.req.query("now")))));
  app.post("/reviews/:id/answer", async (c) => {
    const body = await c.req.json<{ result?: "got_it" | "again" }>().catch(() => ({}) as { result?: "got_it" | "again" });
    if (body.result !== "got_it" && body.result !== "again") return c.json({ error: "result must be got_it or again" }, 400);
    const review = await answerReview(deps.db, c.req.param("id"), body.result);
    return review ? c.json({ review }) : c.json({ error: "review not found" }, 404);
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
