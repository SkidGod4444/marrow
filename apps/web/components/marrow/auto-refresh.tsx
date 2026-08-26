"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetch server data on an interval while something is in flight (ingesting items), so status stays live. */
export function AutoRefresh({ active, everyMs = 8000 }: { active: boolean; everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs, router]);
  return null;
}
