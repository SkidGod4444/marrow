import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

export * from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export type DbHandle = { db: Db; driver: "postgres" | "pglite"; close: () => Promise<void> };

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

export async function createDb(opts: { url?: string; pgliteDir?: string; memory?: boolean }): Promise<DbHandle> {
  if (opts.url) {
    // RDS / docker-compose Postgres. `prepare: false` keeps us safe behind transaction poolers.
    const client = postgres(opts.url, { prepare: false, max: 10 });
    const db = drizzlePg(client, { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS_DIR });
    return { db: db as unknown as Db, driver: "postgres", close: () => client.end() };
  }
  // PGlite: Postgres compiled to WASM — same SQL, same migrations, zero setup.
  // PGlite's NodeFS mkdir is not recursive, so make sure the parent directory exists first.
  const dir = opts.pgliteDir ?? ".marrow/pglite";
  if (!opts.memory) mkdirSync(dir, { recursive: true });
  const client = opts.memory ? new PGlite({ extensions: { vector } }) : new PGlite(dir, { extensions: { vector } });
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db: db as unknown as Db, driver: "pglite", close: () => client.close() };
}
