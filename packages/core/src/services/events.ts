import { type Db, events } from "../db/index.ts";
import { newId } from "../ids.ts";

export type EventKind = "ingested" | "read" | "chatted" | "skipped" | "expression_saved";

/** PRD §11: logged from day one, no consumer in v1. */
export async function logEvent(db: Db, itemId: string, kind: EventKind): Promise<void> {
  await db.insert(events).values({ id: newId("evt"), itemId, kind });
}
