"use client";

import type { InboxEntry } from "@marrow/core";
import { BookOpenText, MessageSquareText, RotateCcw, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmtDate, fmtTs } from "@/lib/time";

const STAGE_LABEL: Record<string, string> = {
  fetch: "Downloading",
  transcribe: "Transcribing",
  diarize: "Finding speakers",
  frames: "Picking keyframes",
  vision: "Reading the slides",
  article: "Writing the article",
  enrich: "Resolving references",
  segment: "Indexing",
  language: "Extracting expressions",
  novelty: "Checking what's new",
};

/** Inbox entries: title, summary, novelty verdict with "new" spans as deep links, and Read / Chat / Skip. */
export function InboxList({ entries, pending, showNamespace }: { entries: InboxEntry[]; pending: InboxEntry[]; showNamespace: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const archive = async (id: string, archived: boolean) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/marrow/items/${id}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      if (archived) toast("Skipped", { action: { label: "Undo", onClick: () => void archive(id, false) } });
      else toast.success("Back in the inbox");
      router.refresh();
    } catch (err) {
      toast.error(archived ? "Couldn't skip" : "Couldn't restore", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const skip = (id: string) => archive(id, true);

  const retry = async (e: InboxEntry) => {
    setBusy(e.id);
    try {
      const res = await fetch("/api/marrow/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ namespace: e.namespace.name, url: e.sourceUrl }) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      toast.success("Retrying", { description: "Resumes at the stage that failed." });
      router.refresh();
    } catch (err) {
      toast.error("Couldn't retry", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-10">
      {entries.length === 0 && pending.length === 0 && <p className="text-sm text-muted-foreground">You&apos;re caught up.</p>}
      <ul className="divide-y divide-border/70 border-y border-border/70">
        {pending.map((p) => (
          <li key={p.id} className="py-5">
            <div
              className={`relative grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6 ${
                p.status === "failed" ? "border-destructive/40 bg-destructive/5" : "border-time/30 bg-card shadow-[0_0_0_1px_color-mix(in_oklch,var(--time)_25%,transparent),0_12px_40px_-16px_color-mix(in_oklch,var(--time)_55%,transparent)]"
              }`}
            >
              <div className="min-w-0 space-y-2.5">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  {showNamespace && <span className="text-foreground/80">{p.namespace.name}</span>}
                  {p.channel && <span>{p.channel}</span>}
                  {p.durationS ? <span>{fmtTs(p.durationS)}</span> : null}
                  {p.status === "failed" ? (
                    <span className="text-destructive">failed{p.job?.stage ? ` while ${(STAGE_LABEL[p.job.stage] ?? p.job.stage).toLowerCase()}` : ""}</span>
                  ) : (
                    <Shimmer className="text-[11px]" duration={1.6}>
                      {p.status === "running" && p.job?.stage ? `${STAGE_LABEL[p.job.stage] ?? p.job.stage}…` : "Queued…"}
                    </Shimmer>
                  )}
                </p>
                <h2 className="reading text-[20px] font-semibold leading-snug tracking-tight">{p.title || p.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}</h2>
                {p.status === "failed" ? (
                  <p className="reading text-[15px] text-foreground/75">We couldn&apos;t finish this one. Retrying picks up where it stopped.</p>
                ) : (
                  <div className="max-w-3xl space-y-2" aria-hidden>
                    <Skeleton className="h-3.5 w-11/12 bg-muted/70" />
                    <Skeleton className="h-3.5 w-3/4 bg-muted/70" />
                  </div>
                )}
              </div>
              <div className="flex items-start gap-2 sm:flex-col sm:items-stretch">
                {p.status === "failed" ? (
                  <Button variant="outline" size="sm" disabled={busy === p.id} onClick={() => void retry(p)}>
                    <RotateCcw />
                    Retry
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                    <span className="size-1.5 animate-pulse rounded-full bg-time" aria-hidden />
                    ingesting
                  </span>
                )}
              </div>
            </div>
          </li>
        ))}
        {entries.map((e) => (
          <li key={e.id} className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
            <div className="min-w-0 space-y-2">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                {showNamespace && <span className="text-foreground/80">{e.namespace.name}</span>}
                {e.channel && <span>{e.channel}</span>}
                {e.durationS ? <span>{fmtTs(e.durationS)}</span> : null}
                <span>{fmtDate(e.createdAt)}</span>
              </p>
              <h2 className="reading text-[20px] font-semibold leading-snug tracking-tight">
                <Link href={`/items/${e.id}`} className="hover:underline">
                  {e.title || e.sourceUrl}
                </Link>
              </h2>
              {e.summary && <p className="reading max-w-3xl text-[15.5px] leading-relaxed text-foreground/85">{e.summary}</p>}
              <Novelty entry={e} />
            </div>
            <div className="flex items-center gap-2 sm:flex-col sm:items-stretch">
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/items/${e.id}`} />}>
                <BookOpenText />
                Read
              </Button>
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/items/${e.id}?tab=chat`} />}>
                <MessageSquareText />
                Chat
              </Button>
              {e.archivedAt ? (
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy === e.id} onClick={() => void archive(e.id, false)}>
                  <Undo2 />
                  Unskip
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy === e.id} onClick={() => void skip(e.id)}>
                  <X />
                  Skip
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>


    </div>
  );
}

function Novelty({ entry }: { entry: InboxEntry }) {
  const n = entry.novelty;
  if (!n) return null;
  const fresh = n.sections.filter((s) => s.label === "new");
  const pct = Math.round(n.overlap_ratio * 100);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
      <span className={`rounded-md border px-1.5 py-px font-mono text-[11px] ${pct >= 70 ? "border-border text-muted-foreground" : "border-time/50 text-time"}`}>
        {pct >= 100 ? "nothing new" : pct === 0 ? "all new" : `${100 - pct}% new`}
      </span>
      {fresh.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-muted-foreground">
          <span>new:</span>
          {fresh.slice(0, 4).map((s, i) => (
            <Link key={i} href={`/items/${entry.id}${s.t_start !== null ? `?t=${Math.floor(s.t_start)}` : ""}`} className="inline-flex items-center gap-1 hover:text-foreground">
              {s.t_start !== null && <span className="timecode">{fmtTs(s.t_start)}</span>}
              <span>{s.topic}</span>
            </Link>
          ))}
        </span>
      )}
      {fresh.length === 0 && n.sections.some((s) => s.covered_by.length) && (
        <span className="text-muted-foreground">covered by {[...new Set(n.sections.flatMap((s) => s.covered_by.map((c) => c.title)))].slice(0, 2).join(", ")}</span>
      )}
    </div>
  );
}
