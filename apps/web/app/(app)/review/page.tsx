import Link from "next/link";
import { ReviewQueue } from "@/components/marrow/review-queue";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Practice", description: "Flashcards for the expressions you marked Learn — each comes back after 2, 7 and 30 days." };

/** PRD §6.3 review queue. `?now=` is a time-travel switch for testing the schedule. */
export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  const sp = await searchParams;
  const now = typeof sp.now === "string" && !Number.isNaN(new Date(sp.now).getTime()) ? sp.now : undefined;
  const q = await api.reviews(now);
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Language</p>
        <h1 className="reading text-[28px] font-semibold tracking-tight">Practice</h1>
        <p className="reading max-w-2xl text-[16px] leading-relaxed text-foreground/85">
          Flashcards for the expressions you marked <b className="font-medium">Learn</b> on an episode&apos;s Language tab. Each one comes back after 2 days, then 7, then 30 — the spacing is what makes it stick.
        </p>
        <p className="text-sm text-muted-foreground">
          {q.total} expression{q.total === 1 ? "" : "s"} in rotation.{" "}
          <Link href="/library" className="underline underline-offset-[3px] hover:text-foreground">
            Find more on a podcast&apos;s Language tab
          </Link>
          .
        </p>
      </header>
      <ReviewQueue due={q.due} upcoming={q.upcoming} total={q.total} />
    </div>
  );
}
