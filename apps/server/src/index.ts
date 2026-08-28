import { InProcessQueue, PgBossQueue, createDb, databaseSsl, createProviders, createStorage, loadConfig, pollAllSources, runJob } from "@marrow/core";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { pollDeps, realRetrieval } from "./deps.ts";

// One process does everything (owner decision): REST API, MCP over HTTP, and the ingestion job runner.
const config = loadConfig();
// MARROW_FAKE=1: no yt-dlp/ffmpeg/OpenAI — fake providers, scripted chat, seeded corpus (E2E tests, UI work).
const fake = process.env.MARROW_FAKE === "1" ? await import("./fakes.ts") : null;
const fakeDeps = fake ? fake.fakeServerDeps() : null;
const { db, driver, close: closeDb } = await createDb({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR, ssl: config.DATABASE_URL ? databaseSsl(config.DATABASE_URL, { mode: config.DATABASE_SSL, caPath: config.DATABASE_SSL_CA }) : undefined });
const storage = createStorage(config);
const providers = fakeDeps?.providers ?? createProviders(config);
if (fake && fakeDeps && process.env.MARROW_FAKE_SEED !== "0") await fake.seedFakeCorpus({ db, storage, config, providers: fakeDeps.providers }, (m) => console.log(`[fake] ${m}`));

const queue = config.DATABASE_URL ? new PgBossQueue(config.DATABASE_URL, databaseSsl(config.DATABASE_URL, { mode: config.DATABASE_SSL, caPath: config.DATABASE_SSL_CA })) : new InProcessQueue();
await queue.start(async (jobId) => {
  await runJob({ db, storage, config, providers, log: (m) => console.log(`[job ${jobId}] ${m}`) }, jobId);
});

// PRD §6.4/§7: poll subscribed playlists/channels/feeds on a schedule (pg-boss cron on Postgres, a timer on PGlite).
if (config.POLL_EVERY_MINUTES > 0) {
  await queue.schedule("poll-sources", config.POLL_EVERY_MINUTES, async () => {
    const results = await pollAllSources({ ...pollDeps(deps), log: (m) => console.log(`[poll] ${m}`) });
    const queued = results.reduce((n, r) => n + r.queued.length, 0);
    if (results.length) console.log(`[poll] ${results.length} sources checked, ${queued} new items queued`);
  });
}

const auth = createAuth(db, config);
if (fake) await fake.seedFakeOwner(auth, (m) => console.log(`[fake] ${m}`));
const deps = fakeDeps ? { db, storage, config, queue, auth, ...fakeDeps } : { db, storage, config, queue, auth, ...realRetrieval(config) };
const app = createApp(deps);

const server = Bun.serve({ port: config.PORT, fetch: app.fetch, idleTimeout: 120 });
console.log(
  `marrow server on http://localhost:${server.port} (db: ${driver}, storage: ${config.STORAGE_DRIVER}, queue: ${config.DATABASE_URL ? "pg-boss" : "in-process"}, poll: ${config.POLL_EVERY_MINUTES ? `every ${config.POLL_EVERY_MINUTES}m` : "off"}, mcp: /mcp, login: ${config.MARROW_AUTH === "on" ? `on (web origin ${config.MARROW_WEB_URL})` : "OFF"}${fake ? " — FAKE MODE (no OpenAI/yt-dlp)" : ""}${config.MARROW_API_KEY ? "" : " — WARNING: MARROW_API_KEY unset, API is open"})`,
);

// Close the DB on the way out: PGlite on disk must be shut down cleanly or the next start can abort in WASM.
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  console.log("shutting down — waiting for in-flight jobs…");
  server.stop();
  await Promise.race([queue.stop(), new Promise((r) => setTimeout(r, 90_000))]);
  await closeDb().catch(() => undefined);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
