import { count } from "drizzle-orm";
import { type Db, authUsers } from "../db/index.ts";

/** Marrow is single-owner (PRD §2): once one account exists, sign-up is closed. */
export async function hasOwner(db: Db): Promise<boolean> {
  const [row] = await db.select({ n: count() }).from(authUsers);
  return Number(row?.n ?? 0) > 0;
}
