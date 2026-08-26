// MCP over stdio — for `claude mcp add marrow -- bun run /path/to/marrow/apps/server/src/mcp-stdio.ts`.
// Logs go to stderr (stdout is the protocol channel). With no DATABASE_URL this process owns the PGlite DB and runs
// ingest jobs itself; with DATABASE_URL it enqueues to pg-boss for the HTTP server to run.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InProcessQueue, PgBossQueue, createDb, createProviders, createStorage, loadConfig, runJob } from "@marrow/core";
import { realRetrieval } from "./deps.ts";
import { createMcpServer } from "./mcp.ts";

const config = loadConfig();
const { db, close: closeDb } = await createDb({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
const storage = createStorage(config);
const providers = createProviders(config);
const queue = config.DATABASE_URL ? new PgBossQueue(config.DATABASE_URL) : new InProcessQueue();
await queue.start(async (jobId) => {
  await runJob({ db, storage, config, providers, log: (m) => console.error(`[job ${jobId}] ${m}`) }, jobId);
});

const server = createMcpServer({ db, storage, config, queue, ...realRetrieval(config) });
const transport = new StdioServerTransport();
transport.onclose = async () => {
  await queue.stop().catch(() => undefined);
  await closeDb().catch(() => undefined);
  process.exit(0);
};
await server.connect(transport);
console.error("marrow mcp (stdio) ready");
