"use client";

import { BookOpenText, Crosshair } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Follow the playhead until the reader scrolls on their own; a button re-engages it (Nielsen #3: user control).
  const [follow, setFollow] = useState(true);
  const programmatic = useRef(0);
  useEffect(() => {
    if (!follow || !activeRef.current) return;
    programmatic.current = Date.now();
    activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, follow]);
  const onUserScroll = () => {
    if (Date.now() - programmatic.current > 900) setFollow(false);
  };

  if (!entries.length) return <p className="text-sm text-muted-foreground">No transcript.</p>;
  const chapterAt = (i: number) => doc.chapters.find((c) => c.t_start <= entries[i]!.t_start && (i === 0 || entries[i - 1]!.t_start < c.t_start));
  const multi = doc.speakers.length > 1;
  const speakerIndex = (id: string) => Math.max(0, doc.speakers.findIndex((s) => s.id === id));
  const speakerLabel = (id: string) => doc.speakers.find((s) => s.id === id)?.label ?? id;

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-muted-foreground">
          {entries.length} lines{multi ? ` · ${doc.speakers.length} speakers` : ""}
        </p>
        <div className="flex items-center gap-1.5">
          <Button variant={follow ? "secondary" : "outline"} size="sm" aria-pressed={follow} onClick={() => setFollow((f) => !f)} title={follow ? "Following the playhead — scroll to read freely" : "Jump to the playhead and keep following it"}>
            <Crosshair />
            {follow ? "Following" : "Follow playhead"}
          </Button>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/items/${doc.id}/read`} />}>
            <BookOpenText />
            Read as text
          </Button>
        </div>
      </div>
      <div ref={scrollerRef} onWheel={onUserScroll} onTouchMove={onUserScroll} className="max-h-[70vh] overflow-y-auto py-1 pr-2 lg:max-h-none lg:min-h-0 lg:flex-1">
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
