"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent, ReactNode } from "react";
import type { Streamdown } from "streamdown";
import { usePlayer, usePlayerOptional } from "./player";
import { fmtTs } from "@/lib/time";

/** A timecode. Click → the player seeks there. The one element set in mono + the accent, everywhere. */
export function TimestampButton({ t, active = false, className = "" }: { t: number; active?: boolean; className?: string }) {
  const { seekTo } = usePlayer();
  return (
    <button
      type="button"
      onClick={() => seekTo(t)}
      data-live={active || undefined}
      className={`timecode focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-time ${className}`}
      title={`Jump to ${fmtTs(t)}`}
    >
      {fmtTs(t)}
    </button>
  );
}

/** Markdown `<a>` override: `#t=754` links seek the player; everything else opens in a new tab. */
export function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const player = usePlayerOptional();
  const m = href ? /^#t=(\d+(?:\.\d+)?)$/.exec(href) : null;
  if (m && player) {
    const t = Number(m[1]);
    return (
      <a
        href={href}
        onClick={(e: MouseEvent) => {
          e.preventDefault();
          player.seekTo(t);
        }}
        className="timecode mx-0.5 align-[-3px] no-underline"
        title={`Jump to ${fmtTs(t)}`}
      >
        {children}
      </a>
    );
  }
  // Namespace chat cites as [Title @ MM:SS](/items/ID?t=S): an internal link that opens the item at that moment.
  if (href?.startsWith("/items/")) {
    return (
      <Link href={href} className="timecode mx-0.5 h-auto whitespace-normal py-0.5 align-[-2px] font-sans normal-case tracking-normal no-underline">
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

type MdComponents = NonNullable<ComponentProps<typeof Streamdown>["components"]>;

/** Pass to Streamdown / MessageResponse so timestamp links seek the player. */
export const markdownComponents: MdComponents = {
  a: ({ href, children }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
};

/** Small mono uppercase label — eyebrows for Summary / Takeaways / References / Chapters. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{children}</h2>;
}

/**
 * The timeline rail: a hairline down the left, with each entry's timecode sitting on it as a tick.
 * Shared by the reader sections, the transcript, and the chapter list so "time" reads the same everywhere.
 */
export function Rail({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative pl-[4.75rem] ${className}`}>
      <span aria-hidden className="absolute bottom-1 left-14 top-1 w-px bg-border" />
      {children}
    </div>
  );
}

export function RailEntry({ t, active = false, children, className = "" }: { t: number | null; active?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {t !== null && (
        <div className="absolute right-full top-[0.3rem] mr-[1.05rem] flex items-center gap-2.5">
          <TimestampButton t={t} active={active} />
          <span aria-hidden className={`size-[7px] translate-x-1/2 rounded-full ring-2 ring-background transition-colors ${active ? "bg-time" : "bg-border"}`} />
        </div>
      )}
      {children}
    </div>
  );
}
