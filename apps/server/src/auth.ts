// Accounts, workspaces and API keys — Better Auth (https://better-auth.com) running inside the API server on our
// Postgres. Owner decision 2026-08-28: Marrow is a multi-tenant SaaS. Users sign up freely, every user gets a personal
// workspace, workspaces have members with roles (owner / admin / member / viewer) checked by the permission matrix
// below, and members mint per-user API keys (bound to one workspace) for MCP/CLI. The web app proxies /api/auth/*.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements, ownerAc } from "better-auth/plugins/organization/access";
import { apiKey } from "@better-auth/api-key";
import { createHash } from "node:crypto";
import { type Config, type Db, adoptOrphanNamespaces, authAccounts, authApiKeys, authInvitations, authMembers, authOrganizations, authSessions, authUsers, authVerifications, lastActiveOrganization, organizationCount, organizationsOf } from "@marrow/core";

export type Auth = ReturnType<typeof createAuth>;

// ---- Permission matrix (resource → actions). Better Auth's own member/invitation/organization statements are kept. ----
export const statement = {
  ...defaultStatements,
  namespace: ["read", "create", "update", "delete"],
  item: ["read", "add", "archive", "delete"], // add = ingest / capture / follow-poll results
  source: ["read", "follow", "unfollow", "poll"],
  chat: ["use"],
  practice: ["use"],
  apikey: ["manage"],
} as const;
export const ac = createAccessControl(statement);
export const roles = {
  viewer: ac.newRole({ namespace: ["read"], item: ["read"], source: ["read"], practice: ["use"] }),
  member: ac.newRole({ namespace: ["read"], item: ["read", "add", "archive"], source: ["read", "follow", "unfollow", "poll"], chat: ["use"], practice: ["use"], apikey: ["manage"] }),
  admin: ac.newRole({
    ...adminAc.statements,
    namespace: ["read", "create", "update", "delete"],
    item: ["read", "add", "archive", "delete"],
    source: ["read", "follow", "unfollow", "poll"],
    chat: ["use"],
    practice: ["use"],
    apikey: ["manage"],
  }),
  owner: ac.newRole({
    ...ownerAc.statements,
    namespace: ["read", "create", "update", "delete"],
    item: ["read", "add", "archive", "delete"],
    source: ["read", "follow", "unfollow", "poll"],
    chat: ["use"],
    practice: ["use"],
    apikey: ["manage"],
  }),
};
export type RoleName = keyof typeof roles;
export type Resource = keyof typeof statement;
export type Action<R extends Resource> = (typeof statement)[R][number];

export function roleCan<R extends Resource>(role: string, resource: R, action: Action<R>): boolean {
  const r = roles[role as RoleName];
  if (!r) return false;
  return r.authorize({ [resource]: [action] } as never).success;
}

/** Everything a role may do, as "resource:action" strings — sent to the web app to shape the UI. */
export function permissionsOf(role: string): string[] {
  const out: string[] = [];
  for (const [resource, actions] of Object.entries(statement)) for (const action of actions) if (roleCan(role, resource as Resource, action as never)) out.push(`${resource}:${action}`);
  return out;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "workspace";

export function createAuth(db: Db, config: Config) {
  const web = config.MARROW_WEB_URL.replace(/\/$/, "");
  // A deploy must never lock people out: without BETTER_AUTH_SECRET, derive a stable secret from the instance key.
  const secret = config.BETTER_AUTH_SECRET ?? (config.MARROW_API_KEY ? createHash("sha256").update(`marrow-auth:${config.MARROW_API_KEY}`).digest("hex") : "marrow-dev-secret-not-for-production");

  const auth = betterAuth({
    appName: "Marrow",
    baseURL: web, // the browser only ever talks to the web app, which proxies /api/auth here
    basePath: "/api/auth",
    secret,
    trustedOrigins: (request) => {
      const origins = [web, "http://localhost:3000", "http://localhost:3100"];
      const origin = request?.headers.get("origin");
      const key = request?.headers.get("x-api-key");
      if (origin && key && config.MARROW_API_KEY && key === config.MARROW_API_KEY) origins.push(origin);
      return origins;
    },
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications, organization: authOrganizations, member: authMembers, invitation: authInvitations, apikey: authApiKeys },
    }),
    emailAndPassword: { enabled: true, minPasswordLength: 8, autoSignIn: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: true, maxAge: 5 * 60 } },
    plugins: [
      organization({
        ac,
        roles,
        creatorRole: "owner",
      requireEmailVerificationOnInvitation: false, // no mail provider: the invite link itself is the proof
        allowUserToCreateOrganization: true,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        // No mail provider in the stack: the inviter copies the link from the members page.
        sendInvitationEmail: async () => undefined,
        organizationHooks: {
          afterCreateOrganization: async ({ organization: org }) => {
            // The very first workspace inherits everything created before multi-tenancy.
            if ((await organizationCount(db)) === 1) await adoptOrphanNamespaces(db, org.id);
          },
        },
      }),
      apiKey({ enableMetadata: true, defaultPrefix: "mrw_", rateLimit: { enabled: false } }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Every account starts with a personal workspace.
            const base = slugify(user.name || user.email.split("@")[0] || "workspace");
            await auth.api.createOrganization({ body: { name: `${user.name || user.email.split("@")[0]}'s workspace`, slug: `${base}-${Math.random().toString(36).slice(2, 7)}`, userId: user.id } });
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            // Land in a workspace: the one created first (personal), unless the client sets another.
            const orgs = await organizationsOf(db, session.userId);
            // Come back to the workspace used last time (if still a member); otherwise the first one.
            const last = await lastActiveOrganization(db, session.userId);
            const remembered = last && orgs.some((o) => o.id === last) ? last : null;
            return { data: { ...session, activeOrganizationId: remembered ?? orgs[0]?.id ?? null } };
          },
        },
      },
    },
    advanced: { database: { generateId: ({ model }) => `${model === "organization" ? "org" : model === "user" ? "usr" : model.slice(0, 3)}_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}` } },
  });
  return auth;
}
