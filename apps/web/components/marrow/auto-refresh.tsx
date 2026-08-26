"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetch server data on an interval while something is in flight (ingesting items), so status stays live. */
export function AutoRefresh({ active, everyMs = 6000, idleMs = 20000 }: { active: boolean; everyMs?: number; idleMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    // Always poll gently so an ingest started elsewhere (library, MCP, a subscription) shows up; faster while in flight.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, active ? everyMs : idleMs);
    return () => clearInterval(t);
  }, [active, everyMs, idleMs, router]);
  return null;
}
