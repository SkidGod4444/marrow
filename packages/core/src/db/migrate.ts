// `bun run db:migrate` — applies packages/core/src/db/migrations to DATABASE_URL (or the local PGlite dir).
import { loadConfig } from "../config.ts";
import { createDb } from "./index.ts";

const cfg = loadConfig();
const handle = await createDb({ url: cfg.DATABASE_URL, pgliteDir: cfg.PGLITE_DIR });
console.log(`migrated (${handle.driver})`);
await handle.close();
