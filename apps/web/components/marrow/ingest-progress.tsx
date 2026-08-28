"use client";

import type { JobProgress } from "@marrow/core";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { estimateIngestSeconds, fmtElapsed, remainingLabel, summarizeSteps } from "@/lib/ingest-estimate";
import { STAGE_LABEL, stageLabel } from "@/lib/stages";

const TEXT_KINDS = new Set(["captured_post", "newsletter", "paper", "note"]);

/** Seconds since an ISO time, ticking once a second — null until mounted (server and client would disagree). */
function useElapsed(since: string): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now === null ? null : Math.max(0, (now - new Date(since).getTime()) / 1000);
}

const SEGMENT: Record<string, string> = {
  done: "bg-foreground/60",
  running: "bg-time animate-pulse",
  failed: "bg-destructive",
  skipped: "bg-muted-foreground/15",
  pending: "bg-muted",
  queued: "bg-muted",
};

/**
 * An ingest in flight, as a person reads it: which step is running (k of n), a stepped bar, time elapsed and what is
 * probably left — polled every few seconds while the job runs. `compact` is the one-line library-row variant.
 */
export function IngestProgress({ job, sourceType, durationS, compact = false }: { job: JobProgress; sourceType: string; durationS?: number | null; compact?: boolean }) {
  const router = useRouter();
  const inFlight = job.state === "queued" || job.state === "running";
  const live = useJobProgressSafe(job.id, inFlight);
  const t = live ?? job;
  const elapsed = useElapsed(t.created_at);
  const { done, total, percent, current } = summarizeSteps(t.steps);
  const estimate = estimateIngestSeconds({ sourceType, durationS });
  const finished = t.state === "done" || t.state === "failed";

  // The moment it finishes, re-render the page (the card becomes a real entry, or shows the failure).
  useEffect(() => {
    if (finished && inFlight) router.refresh();
  }, [finished, inFlight, router]);

  const queued = t.state === "queued" && !current;
  const label = queued ? "Queued — starting soon" : `${stageLabel(current?.stage ?? t.stage) || "Working"}`;
  const stepText = total ? `step ${Math.min(done + 1, total)} of ${total}` : null;
  const remaining = elapsed === null ? null : queued ? null : remainingLabel(elapsed, estimate);

  const bar = (
    <div
      role="progressbar"
      aria-label="Ingest progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${label}, ${stepText ?? ""}`}
      className={`flex gap-px overflow-hidden rounded-full ${compact ? "h-1" : "h-1.5"}`}
    >
      {t.steps.map((s) => (
        <span key={s.stage} className={`flex-1 ${SEGMENT[s.state] ?? SEGMENT.pending}`} title={`${STAGE_LABEL[s.stage] ?? s.stage}${s.state === "skipped" ? " — not needed" : ""}`} />
      ))}
    </div>
  );

  if (compact) {
    return (
      <div className="w-44 space-y-1 text-right">
        <p className="truncate font-mono text-[10px] text-muted-foreground">
          <Shimmer as="span" duration={1.6}>
            {`${label}…`}
          </Shimmer>
          {stepText ? ` · ${done + 1}/${total}` : ""}
          {elapsed !== null ? ` · ${fmtElapsed(elapsed)}` : ""}
        </p>
        {bar}
      </div>
    );
  }
  return (
    <div className="max-w-3xl space-y-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <Shimmer as="span" className="text-[11px]" duration={1.6}>
          {`${label}…`}
        </Shimmer>
        {stepText && <span>{stepText}</span>}
        {elapsed !== null && <span>{fmtElapsed(elapsed)} elapsed</span>}
        {remaining && <span>{remaining}</span>}
      </p>
      {bar}
      <p className="text-[12px] text-muted-foreground">
        {TEXT_KINDS.has(sourceType)
          ? "Reading the page, writing the article and resolving references — usually under a minute."
          : `Pulling the audio, transcribing it word by word, picking keyframes, writing the article and resolving references — usually ${estimateWords(estimate)}. You can leave this page; it lands in the inbox when it's done.`}
      </p>
    </div>
  );
}

const estimateWords = (s: number) => (s < 120 ? "a couple of minutes" : `about ${Math.round(s / 60)} minutes`);

// Polling lives in lib/queries.ts; kept behind a tiny wrapper so the card can render from server data before the first poll.
import { useJobProgress } from "@/lib/queries";
function useJobProgressSafe(jobId: string, active: boolean): JobProgress | undefined {
  return useJobProgress(jobId, active).data;
}
