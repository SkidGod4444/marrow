// `bun run db:migrate` — applies packages/core/src/db/migrations to DATABASE_URL (or the local PGlite dir).
import { loadConfig } from "../config.ts";
import { createDb, databaseSsl } from "./index.ts";

const cfg = loadConfig();
const handle = await createDb({ url: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR, ssl: cfg.DATABASE_URL ? databaseSsl(cfg.DATABASE_URL, { mode: cfg.DATABASE_SSL, caPath: cfg.DATABASE_SSL_CA }) : undefined });
console.log(`migrated (${handle.driver})`);
await handle.close();
