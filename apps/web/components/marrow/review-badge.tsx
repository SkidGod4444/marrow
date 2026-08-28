"use client";

import Link from "next/link";
import { useMe } from "./me-provider";
import { useReviewSummary } from "@/lib/queries";

/** The Practice entry only appears once it means something: a namespace in language mode, or saved expressions. */
export function PracticeLink({ active, languageMode }: { active: boolean; languageMode: boolean }) {
  const me = useMe();
  const summary = useReviewSummary(Boolean(me));
  const show = active || languageMode || (summary.data?.total ?? 0) > 0;
  if (!show) return null;
  const due = summary.data?.due ?? 0;
  return (
    <Link
      href="/review"
      aria-current={active ? "page" : undefined}
      title="Flashcards for the expressions you marked Learn"
      className={`relative rounded-md px-2 py-1 transition-colors hover:text-foreground ${active ? "text-foreground after:absolute after:inset-x-2 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-foreground" : "text-muted-foreground"}`}
    >
      Practice
      {due > 0 && (
        <span className="ml-1 rounded-full bg-time px-1.5 font-mono text-[10px] leading-4 text-time-foreground" aria-label={`${due} due`}>
          {due}
        </span>
      )}
    </Link>
  );
}
