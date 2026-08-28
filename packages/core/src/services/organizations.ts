import { authSessions, authUsers } from "../db/schema";
import { and, asc, count, desc, eq, isNotNull } from "drizzle-orm";
import { type Db, type Member, type Organization, authMembers, authOrganizations } from "../db/index.ts";

// Workspaces are managed by Better Auth's organization plugin (members, invitations, roles). These are the read
// helpers the API needs on every request: who is in what, and with which role.

export type Role = "owner" | "admin" | "member" | "viewer";
export const ROLES: Role[] = ["owner", "admin", "member", "viewer"];

export async function membership(db: Db, userId: string, organizationId: string): Promise<Member | null> {
  const [row] = await db.select().from(authMembers).where(and(eq(authMembers.userId, userId), eq(authMembers.organizationId, organizationId)));
  return row ?? null;
}

export async function organizationsOf(db: Db, userId: string): Promise<Array<Organization & { role: Role; members: number }>> {
  const rows = await db
    .select({ org: authOrganizations, role: authMembers.role })
    .from(authMembers)
    .innerJoin(authOrganizations, eq(authOrganizations.id, authMembers.organizationId))
    .where(eq(authMembers.userId, userId))
    .orderBy(asc(authOrganizations.createdAt));
  const out = [];
  for (const r of rows) {
    const [m] = await db.select({ n: count() }).from(authMembers).where(eq(authMembers.organizationId, r.org.id));
    out.push({ ...r.org, role: (r.role as Role) ?? "member", members: Number(m?.n ?? 0) });
  }
  return out;
}

export async function getOrganization(db: Db, ref: string): Promise<Organization | null> {
  const [row] = await db
    .select()
    .from(authOrganizations)
    .where(ref.startsWith("org_") ? eq(authOrganizations.id, ref) : eq(authOrganizations.slug, ref.toLowerCase()));
  return row ?? null;
}

export async function organizationCount(db: Db): Promise<number> {
  const [row] = await db.select({ n: count() }).from(authOrganizations);
  return Number(row?.n ?? 0);
}

/** The workspace this user had active in their most recent session, if any — a fresh sign-in returns there. */
export async function lastActiveOrganization(db: Db, userId: string): Promise<string | null> {
  const [last] = await db
    .select({ id: authSessions.activeOrganizationId })
    .from(authSessions)
    .where(and(eq(authSessions.userId, userId), isNotNull(authSessions.activeOrganizationId)))
    .orderBy(desc(authSessions.updatedAt))
    .limit(1);
  return last?.id ?? null;
}

/** The account behind a user id (API keys carry only the id). */
export async function getUser(db: Db, id: string): Promise<{ id: string; email: string; name: string } | null> {
  const [row] = await db.select({ id: authUsers.id, email: authUsers.email, name: authUsers.name }).from(authUsers).where(eq(authUsers.id, id));
  return row ?? null;
}
