"use client";

import type { ReviewCard } from "@marrow/core";
import { ArrowUpRight, Check, Play, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fmtDate, fmtTs } from "@/lib/time";

const KIND: Record<string, string> = { idiom: "idiom", phrasal_verb: "phrasal verb", collocation: "collocation", slang: "slang", other: "expression" };

/** PRD §6.3 recall prompts: expression first, meaning on request, then "Got it" (2d → 7d → 30d) or "Again" (back to 2d). */
export function ReviewQueue({ due: initial, upcoming, total }: { due: ReviewCard[]; upcoming: ReviewCard[]; total: number }) {
  const [queue, setQueue] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const card = queue[0] ?? null;

  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    el.addEventListener("ended", () => setPlaying(false));
    el.addEventListener("error", () => setPlaying(false));
    audio.current = el;
    return () => {
      el.pause();
      audio.current = null;
    };
  }, []);
  useEffect(() => {
    setRevealed(false);
    setPlaying(false);
    audio.current?.pause();
  }, [card?.id]);

  const play = () => {
    const el = audio.current;
    if (!el || !card?.clip_url) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.src = `/api/marrow${card.clip_url}`;
    void el.play().then(() => setPlaying(true)).catch(() => toast.error("Couldn't play that clip"));
  };

  const answer = async (result: "got_it" | "again") => {
    if (!card) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/marrow/reviews/${card.id}/answer`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ result }) });
      const body = (await res.json().catch(() => ({}))) as { review?: { dueAt: string }; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      toast(result === "got_it" ? "Got it" : "See you in two days", { description: body.review ? `Next prompt ${fmtDate(body.review.dueAt)}.` : undefined });
      setQueue((q) => q.slice(1));
      setDone((d) => d + 1);
      window.dispatchEvent(new Event("marrow:reviews-changed"));
    } catch (err) {
      toast.error("Couldn't save that answer", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!card || busy) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.key === " " && !revealed) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && (e.key === "1" || e.key.toLowerCase() === "g")) void answer("got_it");
      else if (revealed && (e.key === "2" || e.key.toLowerCase() === "a")) void answer("again");
      else if (e.key.toLowerCase() === "p") play();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!card) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="reading text-[18px] font-medium">{done ? `Done — ${done} reviewed.` : "Nothing due right now."}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {total === 0 ? (
              <>
                Mark expressions with <b className="font-medium text-foreground">Learn</b> on an episode&apos;s Language tab and they come back here as recall prompts.
              </>
            ) : (
              "Expressions come back 2 days after you save them, then 7, then 30."
            )}
          </p>
        </div>
        {upcoming.length > 0 && (
          <div className="space-y-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Coming up</p>
            <ul className="divide-y divide-border/70 border-y border-border/70">
              {upcoming.map((u) => (
                <li key={u.id} className="flex items-baseline gap-4 py-2">
                  <span className="reading min-w-0 flex-1 truncate text-[15px]">{u.text}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{fmtDate(u.dueAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="font-mono text-[11px] text-muted-foreground">
        {queue.length} due{done ? ` · ${done} done` : ""}
      </p>
      <section className="rounded-lg border border-border/70 bg-card px-5 py-6 sm:px-8 sm:py-8" aria-live="polite">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {KIND[card.kind] ?? card.kind} · from{" "}
          <Link href={`/items/${card.itemId}?t=${Math.floor(card.tStart)}&tab=language`} className="normal-case tracking-normal hover:text-foreground">
            {card.item_title}
          </Link>
        </p>
        <h2 className="reading mt-3 text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">{card.text}</h2>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {card.clip_url && (
            <Button variant="outline" size="sm" aria-pressed={playing} onClick={play}>
              {playing ? <Square className="size-3" fill="currentColor" /> : <Play className="size-3.5" fill="currentColor" />}
              {playing ? "Stop" : "Play clip"}
            </Button>
          )}
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/items/${card.itemId}?t=${Math.floor(card.tStart)}&tab=language`} />}>
            Jump to {fmtTs(card.tStart)}
            <ArrowUpRight />
          </Button>
        </div>
        {revealed ? (
          <div className="mt-6 space-y-5">
            <p className="reading text-[17px] leading-relaxed text-foreground/90">{card.explanation}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void answer("got_it")}>
                <Check />
                Got it
                <kbd className="ml-1 rounded border border-border/60 px-1 font-mono text-[10px] text-muted-foreground">1</kbd>
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void answer("again")}>
                <RotateCcw />
                Again
                <kbd className="ml-1 rounded border border-border/60 px-1 font-mono text-[10px] text-muted-foreground">2</kbd>
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6">
            <p className="reading text-[15px] text-muted-foreground">What does it mean? Say it to yourself, then check.</p>
            <Button className="mt-3" size="sm" onClick={() => setRevealed(true)}>
              Show meaning
              <kbd className="ml-1 rounded border border-white/30 px-1 font-mono text-[10px]">space</kbd>
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
