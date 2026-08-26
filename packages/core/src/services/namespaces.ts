import { count, eq, sql } from "drizzle-orm";
import { type Db, type Namespace, type NamespaceFlags, items, namespaces } from "../db/index.ts";
import { newId } from "../ids.ts";

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export async function createNamespace(db: Db, input: { name: string; description?: string; flags?: NamespaceFlags }): Promise<Namespace> {
  const name = input.name.trim().toLowerCase();
  if (!NAME_RE.test(name)) throw new Error(`invalid namespace name "${input.name}" (use lowercase letters, digits, - or _)`);
  const [row] = await db
    .insert(namespaces)
    .values({ id: newId("ns"), name, description: input.description ?? "", flags: input.flags ?? {} })
    .returning();
  return row!;
}

/** Look up by id (`ns_…`) or by name. */
export async function getNamespace(db: Db, ref: string): Promise<Namespace | null> {
  const [row] = await db
    .select()
    .from(namespaces)
    .where(ref.startsWith("ns_") ? eq(namespaces.id, ref) : eq(namespaces.name, ref.trim().toLowerCase()));
  return row ?? null;
}

export type NamespaceSummary = Namespace & { itemCount: number; readyCount: number };

export async function listNamespaces(db: Db): Promise<NamespaceSummary[]> {
  const rows = await db
    .select({
      ns: namespaces,
      itemCount: count(items.id),
      readyCount: sql<number>`coalesce(sum(case when ${items.status} = 'ready' then 1 else 0 end), 0)::int`,
    })
    .from(namespaces)
    .leftJoin(items, eq(items.namespaceId, namespaces.id))
    .groupBy(namespaces.id)
    .orderBy(namespaces.name);
  return rows.map((r) => ({ ...r.ns, itemCount: Number(r.itemCount), readyCount: Number(r.readyCount) }));
}
