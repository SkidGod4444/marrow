import { InProcessQueue, PgBossQueue, createDb, createProviders, createStorage, loadConfig, runJob } from "@marrow/core";
import { createApp } from "./app.ts";
import { realRetrieval } from "./deps.ts";

// One process does everything (owner decision): REST API, MCP over HTTP, and the ingestion job runner.
const config = loadConfig();
const { db, driver } = await createDb({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
const storage = createStorage(config);
const providers = createProviders(config);

const queue = config.DATABASE_URL ? new PgBossQueue(config.DATABASE_URL) : new InProcessQueue();
await queue.start(async (jobId) => {
  await runJob({ db, storage, config, providers, log: (m) => console.log(`[job ${jobId}] ${m}`) }, jobId);
});

const app = createApp({ db, storage, config, queue, ...realRetrieval(config) });

const server = Bun.serve({ port: config.PORT, fetch: app.fetch, idleTimeout: 120 });
console.log(
  `marrow server on http://localhost:${server.port} (db: ${driver}, storage: ${config.STORAGE_DRIVER}, queue: ${config.DATABASE_URL ? "pg-boss" : "in-process"}, mcp: /mcp${config.MARROW_API_KEY ? "" : " — WARNING: MARROW_API_KEY unset, API is open"})`,
);

const shutdown = async () => {
  console.log("shutting down…");
  await queue.stop();
  server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
