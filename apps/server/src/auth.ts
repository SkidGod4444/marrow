// Owner login for the web app — Better Auth (https://better-auth.com) running inside the API server on our Postgres.
// Email + password only; sign-up closes after the first account (Marrow is single-owner, PRD §2). The web app proxies
// /api/auth/* here and gates its pages on the session; MCP and CLI keep using the API key.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { type Config, type Db, authAccounts, authSessions, authUsers, authVerifications, hasOwner } from "@marrow/core";

export type Auth = ReturnType<typeof createAuth>;

export function createAuth(db: Db, config: Config) {
  const web = config.MARROW_WEB_URL.replace(/\/$/, "");
  return betterAuth({
    appName: "Marrow",
    // Requests reach us through the web app's proxy, so the browser-facing origin is the web app's.
    baseURL: web,
    basePath: "/api/auth",
    secret: config.BETTER_AUTH_SECRET ?? (process.env.NODE_ENV === "production" ? undefined : "marrow-dev-secret-not-for-production"),
    trustedOrigins: [web, "http://localhost:3000", "http://localhost:3100"],
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
