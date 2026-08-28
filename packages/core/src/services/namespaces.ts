import { and, count, eq, isNull, sql } from "drizzle-orm";
import { type Db, type Namespace, type NamespaceFlags, items, namespaces } from "../db/index.ts";
import { newId } from "../ids.ts";

// Namespaces belong to a workspace (organization). Every lookup by name is scoped to one; lookups by id verify the
// workspace when one is given. An unscoped name lookup (CLI, tests) only succeeds when the name is globally unique.

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function createNamespace(db: Db, input: { organizationId?: string | null; name: string; description?: string; flags?: NamespaceFlags }): Promise<Namespace> {
  const name = input.name.trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new Error(`invalid namespace name "${input.name}" (use lowercase letters, digits, - or _)`);
  const orgId = input.organizationId ?? null;
  const [dup] = await db
    .select({ id: namespaces.id })
    .from(namespaces)
    .where(and(eq(namespaces.name, name), orgId ? eq(namespaces.organizationId, orgId) : isNull(namespaces.organizationId)));
  if (dup) throw new Error(`a namespace called "${name}" already exists in this workspace`);
  const [row] = await db
    .insert(namespaces)
    .values({ id: newId("ns"), organizationId: orgId, name, description: input.description ?? "", flags: input.flags ?? {} })
    .returning();
  return row!;
}

/** Merge flags (e.g. `{ language_learning: true }`); returns null when the namespace doesn't exist (in this workspace). */
export async function updateNamespaceFlags(db: Db, ref: string, flags: NamespaceFlags, organizationId?: string): Promise<Namespace | null> {
  const ns = await getNamespace(db, ref, organizationId);
  if (!ns) return null;
  const [row] = await db.update(namespaces).set({ flags: { ...ns.flags, ...flags } }).where(eq(namespaces.id, ns.id)).returning();
  return row ?? null;
}

/**
 * Look up by id (`ns_…`) or by name. With `organizationId`, both are confined to that workspace. Without it, a name must
 * be unique across all workspaces (an ambiguous name throws) — never call it unscoped on a request path.
 */
export async function getNamespace(db: Db, ref: string, organizationId?: string): Promise<Namespace | null> {
  const key = ref.trim();
  if (key.startsWith("ns_")) {
    const [row] = await db.select().from(namespaces).where(eq(namespaces.id, key));
    if (!row) return null;
    return organizationId && row.organizationId !== organizationId ? null : row;
  }
  const name = key.toLowerCase();
  const rows = await db
    .select()
    .from(namespaces)
    .where(organizationId ? and(eq(namespaces.name, name), eq(namespaces.organizationId, organizationId)) : eq(namespaces.name, name));
  if (rows.length > 1) throw new Error(`namespace "${name}" exists in several workspaces — say which one`);
  return rows[0] ?? null;
}

export type NamespaceSummary = Namespace & { itemCount: number; readyCount: number };

/** Namespaces of one workspace (or, unscoped, all of them — CLI/tests only). */
export async function listNamespaces(db: Db, organizationId?: string): Promise<NamespaceSummary[]> {
  const rows = await db
    .select({
      ns: namespaces,
      itemCount: count(items.id),
      readyCount: sql<number>`coalesce(sum(case when ${items.status} = 'ready' then 1 else 0 end), 0)::int`,
    })
    .from(namespaces)
    .leftJoin(items, eq(items.namespaceId, namespaces.id))
    .where(organizationId ? eq(namespaces.organizationId, organizationId) : sql`true`)
    .groupBy(namespaces.id)
    .orderBy(namespaces.name);
  return rows.map((r) => ({ ...r.ns, itemCount: Number(r.itemCount), readyCount: Number(r.readyCount) }));
}

/** Delete a namespace with everything in it (rows cascade; derived files are removed best-effort). */
export async function deleteNamespace(db: Db, id: string, storage?: { deletePrefix(prefix: string): Promise<void>; delete(key: string): Promise<void> }): Promise<boolean> {
  const rows = await db.select({ id: items.id }).from(items).where(eq(items.namespaceId, id));
  const [gone] = await db.delete(namespaces).where(eq(namespaces.id, id)).returning({ id: namespaces.id });
  if (!gone) return false;
  if (storage) {
    for (const it of rows) {
      await Promise.all([storage.delete(`documents/${it.id}.json`), storage.delete(`audio/${it.id}.ogg`), storage.deletePrefix(`frames/${it.id}/`), storage.deletePrefix(`clips/${it.id}/`), storage.deletePrefix(`raw/${it.id}/`)]).catch(() => undefined);
    }
  }
  return true;
}

/** Namespaces created before multi-tenancy (no workspace) are handed to the first workspace ever created. */
export async function adoptOrphanNamespaces(db: Db, organizationId: string): Promise<number> {
  const rows = await db.update(namespaces).set({ organizationId }).where(isNull(namespaces.organizationId)).returning({ id: namespaces.id });
  return rows.length;
}
