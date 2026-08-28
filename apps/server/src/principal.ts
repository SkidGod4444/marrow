// Who is calling, and in which workspace. Three ways in: the web app's session cookie (proxied), a per-user API key
// (`x-api-key: mrw_…`, bound to one workspace at creation), or the instance key (`MARROW_API_KEY`) for operators — that
// one must name the workspace (`x-marrow-org` header or `organization` query) and acts as an owner in it.
import { type Db, type Role, getOrganization, membership, organizationsOf } from "@marrow/core";
import type { Auth } from "./auth.ts";
import { type Action, type Resource, permissionsOf, roleCan } from "./auth.ts";

export type Principal = {
  userId: string;
  email: string;
  name: string;
  organizationId: string | null;
  organizationSlug: string | null;
  role: Role | "instance";
  via: "session" | "apikey" | "instance";
};

export type PrincipalDeps = { db: Db; auth?: Auth; instanceKey?: string; authOff?: boolean };

/** Operators (instance key) and local dev (auth off) act as an instance principal: every permission, and — with no
 *  workspace named — the pre-tenancy data (namespaces without a workspace). */
export async function instancePrincipal(db: Db, hint: string | null | undefined): Promise<Principal> {
  const org = hint ? await getOrganization(db, hint) : null;
  return { userId: "instance", email: "instance@marrow", name: "Instance admin", organizationId: org?.id ?? null, organizationSlug: org?.slug ?? null, role: "instance", via: "instance" };
}

export async function resolvePrincipal(deps: PrincipalDeps, headers: Headers, orgHint?: string | null): Promise<Principal | null> {
  const { db, auth } = deps;
  const key = headers.get("x-api-key") ?? headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const hint = orgHint ?? headers.get("x-marrow-org");

  if (key && deps.instanceKey && key === deps.instanceKey) return instancePrincipal(db, hint);
  if (!auth || deps.authOff) {
    // No login layer (unit tests, MARROW_AUTH=off): the instance key is the only lock, and only when configured.
    if (deps.instanceKey && key !== deps.instanceKey) return null;
    return instancePrincipal(db, hint);
  }

  if (key) {
    const v = await auth.api.verifyApiKey({ body: { key } }).catch(() => null);
    if (!v?.valid || !v.key) return null;
    const meta = (v.key.metadata ?? {}) as { organizationId?: string };
    const userId = v.key.referenceId;
    const orgId = meta.organizationId ?? null;
    const m = orgId ? await membership(db, userId, orgId) : null;
    if (orgId && !m) return null; // key outlived the membership
    const org = orgId ? await getOrganization(db, orgId) : null;
    return { userId, email: "", name: v.key.name ?? "API key", organizationId: orgId, organizationSlug: org?.slug ?? null, role: (m?.role as Role) ?? "viewer", via: "apikey" };
  }

  const session = await auth.api.getSession({ headers }).catch(() => null);
  if (!session) return null;
  // Workspace: an explicit hint, else the session's active one, else the user's first workspace (sign-up creates the
  // session before its personal workspace is visible, and a member may have been removed from the active one).
  const hinted = hint ? (await getOrganization(db, hint))?.id : null;
  const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  let wanted: string | null = hinted ?? active;
  let m = wanted ? await membership(db, session.user.id, wanted) : null;
  if (!m && !hinted) {
    const first = (await organizationsOf(db, session.user.id))[0];
    wanted = first?.id ?? null;
    m = wanted ? await membership(db, session.user.id, wanted) : null;
  }
  const org = m && wanted ? await getOrganization(db, wanted) : null;
  return { userId: session.user.id, email: session.user.email, name: session.user.name, organizationId: m ? wanted : null, organizationSlug: org?.slug ?? null, role: (m?.role as Role) ?? "viewer", via: "session" };
}

export function can<R extends Resource>(p: Principal, resource: R, action: Action<R>): boolean {
  if (p.role === "instance") return true;
  if (!p.organizationId) return false;
  return roleCan(p.role, resource, action);
}

/** The workspace a principal's data lives in: its own, or — for an unscoped instance principal — the pre-tenancy pool (`undefined`). */
export function scopeOf(p: Principal): string | undefined {
  return p.organizationId ?? undefined;
}
export function hasScope(p: Principal): boolean {
  return Boolean(p.organizationId) || p.role === "instance";
}

export function permissions(p: Principal): string[] {
  if (p.role === "instance") return permissionsOf("owner");
  return p.organizationId ? permissionsOf(p.role) : [];
}
