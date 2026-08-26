"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PresentedDocument } from "@/lib/api";
import { usePlayer } from "./player";
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
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!entries.length) return <p className="text-sm text-muted-foreground">No transcript.</p>;
  const chapterAt = (i: number) => doc.chapters.find((c) => c.t_start <= entries[i]!.t_start && (i === 0 || entries[i - 1]!.t_start < c.t_start));

  return (
    <div className="max-h-[70vh] overflow-y-auto pr-2 lg:max-h-[calc(100vh-12rem)]">
      <Rail>
        {entries.map((e, i) => {
          const chapter = chapterAt(i);
          return (
            <div key={i}>
              {chapter && <p className="mb-2 mt-6 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground first:mt-0">{chapter.title}</p>}
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
  );
}
