"use client";

import { useEffect, useState } from "react";

/** Due-count badge for the Review nav link; refreshes when a review is saved or answered anywhere in the app. */
export function ReviewBadge() {
  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/marrow/reviews/summary", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ due: number }>) : null))
        .then((s) => alive && s && setDue(s.due))
        .catch(() => undefined);
    void load();
    window.addEventListener("marrow:reviews-changed", load);
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener("marrow:reviews-changed", load);
      clearInterval(t);
    };
  }, []);
  if (!due) return null;
  return (
    <span className="ml-1 rounded-full bg-time px-1.5 font-mono text-[10px] leading-4 text-time-foreground" aria-label={`${due} due`}>
      {due}
    </span>
  );
}
