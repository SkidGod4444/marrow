import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as schema from "./schema.ts";

export * from "./schema.ts";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

export type DbHandle = { db: Db; driver: "postgres" | "pglite"; close: () => Promise<void> };

export type SslOption = false | { rejectUnauthorized: boolean; ca?: string };

const LOCAL_HOST = /@(localhost|127\.0\.0\.1|\[::1\]|db|postgres)(:\d+)?(\/|\?|$)/;

/**
 * TLS settings for a Postgres URL, shared by postgres.js (Drizzle) and pg (pg-boss). Managed databases such as RDS
 * reject plain-text connections ("no pg_hba.conf entry … no encryption"), so anything that isn't localhost/compose
 * gets TLS by default; the RDS CA bundle is verified when present.
 */
export function databaseSsl(url: string, opts: { mode?: "auto" | "require" | "verify-full" | "off"; caPath?: string } = {}): SslOption {
  const mode = opts.mode ?? "auto";
  if (mode === "off") return false;
  if (/[?&]sslmode=disable/.test(url)) return false;
  const local = LOCAL_HOST.test(url);
  if (mode === "auto" && local) return false;
  const caPath = opts.caPath;
  const ca = caPath && existsSync(caPath) ? readFileSync(caPath, "utf8") : undefined;
  if (mode === "verify-full" || (mode === "auto" && ca)) return { rejectUnauthorized: true, ...(ca ? { ca } : {}) };
  return { rejectUnauthorized: false };
}

const MIGRATIONS_DIR = fileURLToPath(new URL("./migrations", import.meta.url));

/**
 * Drop `sslmode`/`ssl`/`uselibpqcompat` from the URL: we pass TLS options explicitly, and `pg` lets URL parameters
 * override them (a stray `?sslmode=require` then forces verification without our CA and fails with
 * SELF_SIGNED_CERT_IN_CHAIN). `databaseSsl` reads `sslmode=disable` before this runs.
 */
export function stripSslParams(url: string): string {
  const q = url.indexOf("?");
  if (q === -1) return url;
  const params = new URLSearchParams(url.slice(q + 1));
  for (const k of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) params.delete(k);
  const rest = params.toString();
  return url.slice(0, q) + (rest ? `?${rest}` : "");
}

export async function createDb(opts: { url?: string; pgliteDir?: string; memory?: boolean; ssl?: SslOption }): Promise<DbHandle> {
  if (opts.url) {
    // RDS / docker-compose Postgres. `prepare: false` keeps us safe behind transaction poolers.
    const ssl = opts.ssl ?? databaseSsl(opts.url);
    const client = postgres(stripSslParams(opts.url), { prepare: false, max: 10, ...(ssl ? { ssl } : {}) });
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
