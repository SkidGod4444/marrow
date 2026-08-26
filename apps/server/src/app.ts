import { Hono } from "hono";
import {
  type Config, type Db, type JobQueue, createIngest, createNamespace, getJobStatus, getNamespace, listItems, listNamespaces,
} from "@marrow/core";

export type AppDeps = { db: Db; config: Config; queue: JobQueue };

/** REST skin over the service layer (PRD §8). Phase 1 exposes ingest/job/namespace/item; Phase 2 adds the rest + MCP. */
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

  app.get("/namespaces", async (c) => c.json({ namespaces: await listNamespaces(deps.db) }));

  app.post("/namespaces", async (c) => {
    const body = await c.req.json<{ name: string; description?: string; flags?: Record<string, boolean> }>();
    try {
      return c.json({ namespace: await createNamespace(deps.db, body) }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.get("/items", async (c) => {
    const ref = c.req.query("namespace");
    if (!ref) return c.json({ error: "namespace is required" }, 400);
    const ns = await getNamespace(deps.db, ref);
    if (!ns) return c.json({ error: "namespace not found" }, 404);
    return c.json({ items: await listItems(deps.db, ns.id, c.req.query("status")) });
  });

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
