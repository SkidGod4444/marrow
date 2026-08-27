"use client";

import { ArrowUpRight, Download } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { PresentedDocument } from "@/lib/api";
import { isWebUrl, kindLabel } from "@/lib/kind";
import { fmtDate } from "@/lib/time";
import { Description } from "./description";
import { Eyebrow } from "./timestamp-link";

/** What sits where the player would be for a text item: provenance, the owner's note, and linked videos to ingest (PRD §7). */
export function SourceCard({ doc }: { doc: PresentedDocument }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const ingest = async (url: string) => {
    setBusy(url);
    try {
      const res = await fetch("/api/marrow/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ namespace: doc.namespace_id, url }) });
      const body = (await res.json()) as { reused?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      toast.success(body.reused ? "Already in the library" : "Queued", { description: body.reused ? "It is already ingested or on its way." : "Watch it come in on the inbox." });
      router.refresh();
    } catch (err) {
      toast.error("Couldn't ingest", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border/70 bg-card px-4 py-3.5">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 font-mono text-[12px]">
          <dt className="text-muted-foreground">kind</dt>
          <dd>{kindLabel(doc.source_type)}</dd>
          {doc.author && (
            <>
              <dt className="text-muted-foreground">author</dt>
              <dd className="truncate">{doc.author}</dd>
            </>
          )}
          {doc.channel && doc.channel !== doc.author && (
            <>
              <dt className="text-muted-foreground">from</dt>
              <dd className="truncate">{doc.channel}</dd>
            </>
          )}
          {doc.published_at && (
            <>
              <dt className="text-muted-foreground">published</dt>
              <dd>{fmtDate(doc.published_at)}</dd>
            </>
          )}
          <dt className="text-muted-foreground">length</dt>
          <dd>{Math.max(1, Math.round(doc.body_md.split(/\s+/).length / 200))} min read · {doc.body_md.split(/\s+/).length.toLocaleString("en-US")} words</dd>
          {isWebUrl(doc.source_url) && (
            <>
              <dt className="text-muted-foreground">source</dt>
              <dd className="truncate">
                <a href={doc.source_url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-0.5 hover:text-foreground">
                  <span className="truncate">{doc.source_url.replace(/^https?:\/\/(www\.)?/, "")}</span>
                  <ArrowUpRight className="size-3 shrink-0" />
                </a>
              </dd>
            </>
          )}
        </dl>
      </div>
      {doc.description.trim() && (
        <div className="space-y-2">
          <Eyebrow>Note</Eyebrow>
          <Description text={doc.description} />
        </div>
      )}
      {doc.linked_videos.length > 0 && (
        <div className="space-y-2">
          <Eyebrow>Linked videos</Eyebrow>
          <ul className="space-y-1.5">
            {doc.linked_videos.map((v) => (
              <li key={v} className="flex items-center gap-2 text-[13px]">
                <a href={v} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-mono text-[12px] text-muted-foreground hover:text-foreground">
                  {v.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
                <Button variant="outline" size="xs" disabled={busy === v} onClick={() => void ingest(v)}>
                  <Download />
                  Ingest
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
