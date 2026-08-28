import { InProcessQueue, PgBossQueue, createDb, databaseSsl, createProviders, createStorage, loadConfig, pollAllSources, runJob, recoverJobs, failJobIfUnstarted, probeStorage, backfillUsageFromJobs, probeYoutube } from "@marrow/core";
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

const queue = config.DATABASE_URL ? new PgBossQueue(config.DATABASE_URL, databaseSsl(config.DATABASE_URL, { mode: config.DATABASE_SSL, caPath: config.DATABASE_SSL_CA })) : new InProcessQueue();
// Storage check at boot and every 5 minutes: on GET /health as `storage`, and loud in the log — with empty S3
// credentials every ingest would otherwise fail silently at its first storage call.
let storageStatus: "ok" | "error" | "unknown" = "unknown";
const checkStorage = async () => {
  const r = await probeStorage(storage);
  if (r.status === "error" && storageStatus !== "error") console.error(`[storage] ${config.STORAGE_DRIVER} check failed: ${r.error} — ingests will fail until this is fixed (docs/DEPLOY.md, "S3 credentials")`);
  if (r.status === "ok" && storageStatus === "error") console.log("[storage] check passes again");
  storageStatus = r.status;
};
await checkStorage();
setInterval(() => void checkStorage(), 5 * 60_000).unref();

await queue.start(
  async (jobId) => {
    try {
      await runJob({ db, storage, config, providers, log: (m) => console.log(`[job ${jobId}] ${m}`) }, jobId);
    } catch (err) {
      // The runner records stage failures itself; anything that threw before a stage ran (no storage credentials,
      // a missing row) would otherwise leave the item on "queued" forever with the reason only in the broker.
      if (await failJobIfUnstarted(db, jobId, err).catch(() => false)) console.error(`[job ${jobId}] failed before it could start: ${(err as Error).message}`);
      throw err;
    }
  },
  { concurrency: config.INGEST_CONCURRENCY },
);
// Whatever the previous process left queued or running (a deploy restarts the server) goes back on the queue now.
await recoverJobs(db, queue, (m) => console.log(`[queue] ${m}`));
// Jobs from before the spend ledger existed get their rows from the stage records they carry (idempotent).
await backfillUsageFromJobs(db, (m) => console.log(`[usage] ${m}`)).catch((e) => console.error("[usage] backfill failed:", e));

// PRD §6.4/§7: poll subscribed playlists/channels/feeds on a schedule (pg-boss cron on Postgres, a timer on PGlite).
if (config.POLL_EVERY_MINUTES > 0) {
  await queue.schedule("poll-sources", config.POLL_EVERY_MINUTES, async () => {
    const results = await pollAllSources({ ...pollDeps(deps), log: (m) => console.log(`[poll] ${m}`) });
    const queued = results.reduce((n, r) => n + r.queued.length, 0);
    if (results.length) console.log(`[poll] ${results.length} sources checked, ${queued} new items queued`);
  });
}

const auth = createAuth(db, config);
if (fake && fakeDeps) {
  const seeded = await fake.seedFakeAccounts(db, auth, (m) => console.log(`[fake] ${m}`));
  if (process.env.MARROW_FAKE_SEED !== "0") await fake.seedFakeCorpus({ db, storage, config, providers: fakeDeps.providers, organizationId: seeded.organizationId }, (m) => console.log(`[fake] ${m}`));
}
// YouTube reachability with the configured cookies: one tiny request at boot and every 6 hours, on /health as `youtube`.
// "cookies_stale" is the verdict that once cost a day: the exported session had been rotated by the browser.
let youtubeStatus = "unknown";
const checkYoutube = async () => {
  if (fake) return;
  const r = await probeYoutube(config);
  if (r.status !== youtubeStatus) console.log(`[youtube] ${r.status}${r.detail ? ` — ${r.detail}` : ""}`);
  youtubeStatus = r.status;
};
void checkYoutube().catch((e) => console.error("[youtube] probe failed:", e));
setInterval(() => void checkYoutube().catch(() => undefined), 6 * 60 * 60_000).unref();
// The cookie keeper (docker-compose.prod.yml) writes its report next to the jar; surface it as it is.
const keeperStatus = async () => {
  const path = process.env.KEEPER_STATUS;
  if (!path) return null;
  try {
    return JSON.parse(await Bun.file(path).text()) as unknown;
  } catch {
    return null;
  }
};
const health = { storage: () => storageStatus, youtube: () => youtubeStatus, keeper: keeperStatus, recheckYoutube: checkYoutube };
const deps = fakeDeps ? { db, storage, config, queue, auth, health, ...fakeDeps } : { db, storage, config, queue, auth, health, ...realRetrieval(config) };
const app = createApp(deps);

const server = Bun.serve({ port: config.PORT, fetch: app.fetch, idleTimeout: 120 });
console.log(
  `marrow server on http://localhost:${server.port} (db: ${driver}, storage: ${config.STORAGE_DRIVER}, queue: ${config.DATABASE_URL ? "pg-boss" : "in-process"} ×${config.INGEST_CONCURRENCY}, storage check: ${storageStatus}, poll: ${config.POLL_EVERY_MINUTES ? `every ${config.POLL_EVERY_MINUTES}m` : "off"}, mcp: /mcp, accounts: ${config.MARROW_AUTH === "on" ? `on (web origin ${config.MARROW_WEB_URL})` : "OFF"}${fake ? " — FAKE MODE (no OpenAI/yt-dlp)" : ""}${config.MARROW_API_KEY ? "" : " — WARNING: MARROW_API_KEY unset, API is open"})`,
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
