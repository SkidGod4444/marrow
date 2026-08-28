"use client";

import type { InboxEntry } from "@marrow/core";
import { BookOpenText, MessageSquareText, RotateCcw, Undo2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { kindLabel } from "@/lib/kind";
import { fmtUsd } from "@/lib/format";
import { stageLabel } from "@/lib/stages";
import { useArchiveMutation, useIngestMutation } from "@/lib/queries";
import { IngestProgress } from "./ingest-progress";
import { useCan } from "./me-provider";
import { fmtDay, fmtTs } from "@/lib/time";

/** Inbox entries: title, summary, novelty verdict with "new" spans as deep links, and Read / Chat / Skip. */
export function InboxList({ entries, pending, showNamespace }: { entries: InboxEntry[]; pending: InboxEntry[]; showNamespace: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const canArchive = useCan("item:archive");
  const canAdd = useCan("item:add");
  const canChat = useCan("chat:use");

  const archiveMutation = useArchiveMutation();
  const ingestMutation = useIngestMutation();
  const archive = (id: string, archived: boolean) => {
    setBusy(id);
    archiveMutation.mutate(
      { id, archived },
      {
        onSuccess: () => {
          if (archived) toast("Skipped", { action: { label: "Undo", onClick: () => archive(id, false) } });
          else toast.success("Back in the inbox");
          router.refresh();
        },
        onError: (err) => toast.error(archived ? "Couldn't skip" : "Couldn't restore", { description: (err as Error).message }),
        onSettled: () => setBusy(null),
      },
    );
  };
  const skip = (id: string) => archive(id, true);

  const retry = (e: InboxEntry) => {
    setBusy(e.id);
    ingestMutation.mutate(
      { namespace: e.namespace.id, url: e.sourceUrl },
      {
        onSuccess: () => {
          toast.success("Retrying", { description: "Resumes at the stage that failed." });
          router.refresh();
        },
        onError: (err) => toast.error("Couldn't retry", { description: (err as Error).message }),
        onSettled: () => setBusy(null),
      },
    );
  };

  return (
    <div className="space-y-10">
      {entries.length === 0 && pending.length === 0 && <p className="text-sm text-muted-foreground">You&apos;re caught up.</p>}
      <ul className="divide-y divide-border/70 border-y border-border/70">
        {pending.map((p) => (
          <li key={p.id} className="py-5">
            <div
              className={`relative grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6 ${
                p.status === "failed" ? "border-destructive/40 bg-destructive/5" : "border-border/70 bg-card shadow-[0_14px_40px_-22px_rgb(0_0_0/0.8)]" // in flight: a lifted panel; red is for failure only
              }`}
            >
              <div className="min-w-0 space-y-2.5">
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                  {showNamespace && <span className="text-foreground/80">{p.namespace.name}</span>}
                  {p.sourceType !== "youtube_video" && <span className="rounded-md border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">{kindLabel(p.sourceType)}</span>}
                  {p.channel && <span>{p.channel}</span>}
                  {p.durationS ? <span>{fmtTs(p.durationS)}</span> : null}
                  {p.status === "failed" && <span className="text-destructive">failed{p.job?.stage ? ` while ${stageLabel(p.job.stage).toLowerCase()}` : ""}</span>}
                </p>
                <h2 className="reading text-[20px] font-semibold leading-snug tracking-tight">{p.title || p.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}</h2>
                {p.status === "failed" ? (
                  <div className="space-y-1">
                    <p className="reading text-[15px] text-foreground/75">We couldn&apos;t finish this one. Retrying picks up where it stopped.</p>
                    {p.job?.error && <p className="font-mono text-[11px] text-muted-foreground line-clamp-2">Reason: {p.job.error.replace(/^[a-z]+: /, "")}</p>}
                  </div>
                ) : p.job ? (
                  <IngestProgress job={p.job} sourceType={p.sourceType} durationS={p.durationS} />
                ) : (
                  <div className="max-w-3xl space-y-2" aria-hidden>
                    <Skeleton className="h-3.5 w-11/12 bg-muted/70" />
                    <Skeleton className="h-3.5 w-3/4 bg-muted/70" />
                  </div>
                )}
              </div>
              <div className="flex items-start gap-2 sm:flex-col sm:items-stretch">
                {p.status === "failed" ? (
                  <>
                    {canAdd && (
                      <Button variant="outline" size="sm" disabled={busy === p.id} onClick={() => retry(p)}>
                        <RotateCcw />
                        Retry
                      </Button>
                    )}
                    {!canArchive ? null : p.archivedAt ? (
                      <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy === p.id} onClick={() => archive(p.id, false)}>
                        <Undo2 />
                        Unskip
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy === p.id} onClick={() => skip(p.id)} title="Hide this one">
                        <X />
                        Skip
                      </Button>
                    )}
                  </>
                ) : null}
              </div>
            </div>
          </li>
        ))}
        {entries.map((e) => (
          <li key={e.id} className="grid gap-3 py-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-6">
            <div className="min-w-0 space-y-2">
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                {showNamespace && <span className="text-foreground/80">{e.namespace.name}</span>}
                {e.sourceType !== "youtube_video" && <span className="rounded-md border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">{kindLabel(e.sourceType)}</span>}
                {e.channel && <span>{e.channel}</span>}
                {e.durationS ? <span>{fmtTs(e.durationS)}</span> : null}
                <span>{fmtDay(e.createdAt)}</span>
                {e.usage && e.usage.cost_usd > 0 && <span title="API spend so far, everything included">{fmtUsd(e.usage.cost_usd)}</span>}
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
              {canChat && (
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/items/${e.id}?tab=chat`} />}>
                  <MessageSquareText />
                  Chat
                </Button>
              )}
              {!canArchive ? null : e.archivedAt ? (
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy === e.id} onClick={() => archive(e.id, false)}>
                  <Undo2 />
                  Unskip
                </Button>
              ) : (
                <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy === e.id} onClick={() => skip(e.id)}>
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
