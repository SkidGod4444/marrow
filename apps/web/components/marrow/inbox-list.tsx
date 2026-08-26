"use client";

import type { InboxEntry } from "@marrow/core";
import { BookOpenText, MessageSquareText, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtTs } from "@/lib/time";

/** Inbox entries: title, summary, novelty verdict with "new" spans as deep links, and Read / Chat / Skip. */
export function InboxList({ entries, pending, showNamespace }: { entries: InboxEntry[]; pending: InboxEntry[]; showNamespace: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const skip = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/marrow/items/${id}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
      if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? res.statusText);
      toast("Skipped", {
        action: {
          label: "Undo",
          onClick: () => void fetch(`/api/marrow/items/${id}/archive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ archived: false }) }).then(() => router.refresh()),
        },
      });
      router.refresh();
    } catch (err) {
      toast.error("Couldn't skip", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-10">
      {entries.length === 0 && <p className="text-sm text-muted-foreground">You&apos;re caught up.</p>}
      <ul className="divide-y divide-border/70 border-y border-border/70">
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
              <Button variant="ghost" size="sm" className="text-muted-foreground" disabled={busy === e.id} onClick={() => void skip(e.id)}>
                <X />
                Skip
              </Button>
            </div>
          </li>
        ))}
      </ul>

      {pending.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Ingesting</h2>
          <ul className="divide-y divide-border/70 border-y border-border/70 text-sm">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2.5">
                <span className={`size-1.5 shrink-0 rounded-full ${p.status === "failed" ? "bg-destructive" : p.status === "running" ? "animate-pulse bg-time" : "bg-muted-foreground/40"}`} />
                <span className="min-w-0 flex-1 truncate">{p.title || p.sourceUrl}</span>
                {showNamespace && <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">{p.namespace.name}</span>}
                <span className="font-mono text-[11px] text-muted-foreground">{p.status}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
