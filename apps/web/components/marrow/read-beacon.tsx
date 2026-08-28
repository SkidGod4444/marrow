"use client";

import { useEffect } from "react";

/** Counts a read on the public page without making the page dynamic (PRD §11 events). Fire-and-forget. */
export function ReadBeacon({ itemId }: { itemId: string }) {
  useEffect(() => {
    void fetch(`/api/marrow/public/items/${itemId}/events`, { method: "POST", keepalive: true }).catch(() => undefined);
  }, [itemId]);
  return null;
}
