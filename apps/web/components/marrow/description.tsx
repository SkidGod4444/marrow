"use client";

import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { parseTs } from "@/lib/time";
import { TimestampButton } from "./timestamp-link";

// The uploader's description, with URLs and MM:SS timestamps made clickable (descriptions carry links and chapters).

const TOKEN = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\b(?:\d{1,2}:)?\d{1,2}:\d{2}\b)/g;

function renderLine(line: string, key: number) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of line.matchAll(TOKEN)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(line.slice(last, i));
    if (m[1]) {
      const url = m[1];
      const label = url.replace(/^https?:\/\/(www\.)?/, "");
      parts.push(
        <a key={`${key}-${i}`} href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-baseline gap-0.5 break-all text-foreground underline decoration-foreground/30 underline-offset-[3px] hover:decoration-foreground">
          {label.length > 60 ? `${label.slice(0, 58)}…` : label}
          <ArrowUpRight className="size-3 shrink-0 translate-y-0.5 opacity-60" />
        </a>,
      );
    } else if (m[2]) {
      const t = parseTs(m[2]);
      parts.push(t === null ? m[2] : <TimestampButton key={`${key}-${i}`} t={t} className="mx-0.5 align-[-4px]" />);
    }
    last = i + m[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export function Description({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const lines = text.replace(/\r/g, "").split("\n");
  const long = text.length > 420 || lines.length > 7;
  return (
    <section className="space-y-2">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Description</p>
      <div className="relative">
        <div className={`whitespace-pre-wrap text-[14px] leading-relaxed text-foreground/85 ${long && !open ? "max-h-40 overflow-hidden" : ""}`}>
          {lines.map((l, i) => (
            <div key={i} className="min-h-[1em]">
              {renderLine(l, i)}
            </div>
          ))}
        </div>
        {long && !open && <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-background to-transparent" />}
      </div>
      {long && (
        <Button variant="outline" size="xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Show more"}
        </Button>
      )}
    </section>
  );
}
