"use client";

import { BookOpenText } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { PresentedDocument } from "@/lib/api";
import { usePlayer } from "./player";
import { SpeakerDot } from "./speakers";
import { Rail, RailEntry } from "./timestamp-link";

/** Timestamped transcript on the timeline rail; the entry under the playhead is marked and kept in view. */
export function Transcript({ doc }: { doc: PresentedDocument }) {
  const { currentTime } = usePlayer();
  const entries = doc.transcript ?? [];
  const active = useMemo(() => {
    let idx = -1;
    for (let i = 0; i < entries.length; i++) if (entries[i]!.t_start <= currentTime) idx = i;
    return idx;
  }, [entries, currentTime]);
  const activeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);

  if (!entries.length) return <p className="text-sm text-muted-foreground">No transcript.</p>;
  const chapterAt = (i: number) => doc.chapters.find((c) => c.t_start <= entries[i]!.t_start && (i === 0 || entries[i - 1]!.t_start < c.t_start));
  const multi = doc.speakers.length > 1;
  const speakerIndex = (id: string) => Math.max(0, doc.speakers.findIndex((s) => s.id === id));
  const speakerLabel = (id: string) => doc.speakers.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-muted-foreground">
          {entries.length} lines{multi ? ` · ${doc.speakers.length} speakers` : ""}
        </p>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/items/${doc.id}/read`} />}>
          <BookOpenText />
          Read as text
        </Button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto py-1 pr-2 lg:max-h-[calc(100vh-14rem)]">
      <Rail>
        {entries.map((e, i) => {
          const chapter = chapterAt(i);
          const speakerChanged = multi && (i === 0 || entries[i - 1]!.speaker !== e.speaker);
          return (
            <div key={i}>
              {chapter && <p className="mb-2 mt-6 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground first:mt-0">{chapter.title}</p>}
              {speakerChanged && (
                <p className="mb-1 mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground first:mt-0">
                  <SpeakerDot index={speakerIndex(e.speaker)} />
                  {speakerLabel(e.speaker)}
                </p>
              )}
              <RailEntry t={e.t_start} active={i === active} className="py-1">
                <p ref={i === active ? activeRef : undefined} className={`reading text-[16px] leading-relaxed transition-colors ${i === active ? "text-foreground" : "text-foreground/70"}`}>
                  {e.text}
                </p>
              </RailEntry>
            </div>
          );
        })}
      </Rail>
      </div>
    </div>
  );
}
