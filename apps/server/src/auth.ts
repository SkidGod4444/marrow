// Owner login for the web app — Better Auth (https://better-auth.com) running inside the API server on our Postgres.
// Email + password only; sign-up closes after the first account (Marrow is single-owner, PRD §2). The web app proxies
// /api/auth/* here and gates its pages on the session; MCP and CLI keep using the API key.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { createHash } from "node:crypto";
import { type Config, type Db, authAccounts, authSessions, authUsers, authVerifications, hasOwner } from "@marrow/core";

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(db: Db, config: Config) {
  const web = config.MARROW_WEB_URL.replace(/\/$/, "");
  // A deploy must never lock the owner out: without BETTER_AUTH_SECRET, derive a stable secret from the API key
  // (already a long random value on the box). Setting BETTER_AUTH_SECRET later invalidates existing sessions only.
  const secret = config.BETTER_AUTH_SECRET ?? (config.MARROW_API_KEY ? createHash("sha256").update(`marrow-auth:${config.MARROW_API_KEY}`).digest("hex") : "marrow-dev-secret-not-for-production");
  return betterAuth({
    appName: "Marrow",
    // Requests reach us through the web app's proxy, so the browser-facing origin is the web app's.
    baseURL: web,
    basePath: "/api/auth",
    secret,
    // CSRF: the configured web origin, local dev, and — because the web app's proxy identifies itself with the API
    // key — whatever origin that proxy reports, so a fresh deploy works before MARROW_WEB_URL is set.
    trustedOrigins: (request) => {
      const origins = [web, "http://localhost:3000", "http://localhost:3100"];
      const origin = request?.headers.get("origin");
      const key = request?.headers.get("x-api-key");
      if (origin && key && config.MARROW_API_KEY && key === config.MARROW_API_KEY) origins.push(origin);
      return origins;
    },
    database: drizzleAdapter(db, { provider: "pg", schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications } }),
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: true, maxAge: 5 * 60 } },
    databaseHooks: {
      user: {
        create: {
          before: async () => {
            if (await hasOwner(db)) throw new APIError("FORBIDDEN", { message: "Marrow is single-owner: the owner account already exists. Sign in instead." });
          },
        },
      },
    },
    advanced: { database: { generateId: () => `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}` } },
  });
}

/** The session behind a request's cookies, or null. */
export async function sessionOf(auth: Auth, headers: Headers) {
  try {
    return await auth.api.getSession({ headers });
  } catch {
    return null;
  }
}
