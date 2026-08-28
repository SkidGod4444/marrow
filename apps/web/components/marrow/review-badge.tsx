"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Summary = { due: number; total: number };

/**
 * The Practice entry only exists once it means something: a namespace in language mode, or expressions already saved.
 * The due count refreshes when a review is saved or answered anywhere in the app.
 */
export function PracticeLink({ active }: { active: boolean }) {
  const [state, setState] = useState<{ show: boolean; due: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [s, ns] = await Promise.all([
          fetch("/api/marrow/reviews/summary", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Summary>) : null)),
          fetch("/api/marrow/namespaces", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ namespaces: Array<{ flags?: { language_learning?: boolean } }> }>) : null)),
        ]);
        if (!alive) return;
        const language = ns?.namespaces.some((n) => n.flags?.language_learning) ?? false;
        setState({ show: language || (s?.total ?? 0) > 0, due: s?.due ?? 0 });
      } catch {
        /* nav stays as it is */
      }
    };
    void load();
    window.addEventListener("marrow:reviews-changed", load);
    const t = setInterval(load, 5 * 60 * 1000);
    return () => {
      alive = false;
      window.removeEventListener("marrow:reviews-changed", load);
      clearInterval(t);
    };
  }, []);
  if (!state?.show && !active) return null;
  return (
    <Link
      href="/review"
      aria-current={active ? "page" : undefined}
      title="Flashcards for the expressions you marked Learn"
      className={`relative rounded-md px-2 py-1 transition-colors hover:text-foreground ${active ? "text-foreground after:absolute after:inset-x-2 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-foreground" : "text-muted-foreground"}`}
    >
      Practice
      {state && state.due > 0 && (
        <span className="ml-1 rounded-full bg-time px-1.5 font-mono text-[10px] leading-4 text-time-foreground" aria-label={`${state.due} due`}>
          {state.due}
        </span>
      )}
    </Link>
  );
}
