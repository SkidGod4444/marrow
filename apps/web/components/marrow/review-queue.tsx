"use client";

import type { ReviewCard } from "@marrow/core";
import { ArrowUpRight, Check, Play, RotateCcw, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAnswerReview } from "@/lib/queries";
import { usePracticeStore } from "@/lib/store";
import { fmtDay, fmtTs } from "@/lib/time";
import { ContextQuote } from "./language-pack";

const KIND: Record<string, string> = { idiom: "idiom", phrasal_verb: "phrasal verb", collocation: "collocation", slang: "slang", other: "expression" };

/** PRD §6.3 recall prompts: expression first, meaning on request, then "Got it" (2d → 7d → 30d) or "Again" (back to 2d). */
export function ReviewQueue({ due: initial, upcoming, total }: { due: ReviewCard[]; upcoming: ReviewCard[]; total: number }) {
  const [queue, setQueue] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const answerMutation = useAnswerReview();
  const busy = answerMutation.isPending;
  const { done, bump, reset } = usePracticeStore();
  useEffect(() => reset(), [reset]);
  const total0 = initial.length;
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
    if (!card || busy) return;
    answerMutation.mutate(
      { id: card.id, result },
      {
        onSuccess: (body) => {
          toast(result === "got_it" ? "Got it" : "See you in two days", { description: body.review ? `Next prompt ${fmtDay(body.review.dueAt)}.` : undefined });
          setQueue((q) => q.slice(1));
          bump();
        },
      },
    );
  };

  const later = () => {
    if (!card || queue.length < 2) return;
    setQueue((q) => [...q.slice(1), q[0]!]);
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
      else if (e.key.toLowerCase() === "l") later();
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
                Press <b className="font-medium text-foreground">Learn</b> next to an expression on an episode&apos;s Language tab and it shows up here as a flashcard.
              </>
            ) : (
              "Cards come back 2 days after you save them, then 7, then 30."
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
                  <span className="font-mono text-[11px] text-muted-foreground">{fmtDay(u.dueAt)}</span>
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
      <p className="flex items-center gap-3 font-mono text-[11px] text-muted-foreground" aria-live="polite">
        <span>
          card {done + 1} of {total0}
        </span>
        <span className="h-1 w-32 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className="block h-full rounded-full bg-foreground transition-[width]" style={{ width: `${(done / Math.max(1, total0)) * 100}%` }} />
        </span>
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
            {card.context && <ContextQuote context={card.context} text={card.text} className="text-[16px]" />}
            <p className="reading text-[17px] leading-relaxed text-foreground/90">{card.explanation}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={busy} onClick={() => void answer("got_it")}>
                <Check />
                Got it
                <kbd className="ml-1 hidden rounded border border-border/60 px-1 font-mono text-[10px] text-muted-foreground sm:inline">1</kbd>
              </Button>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void answer("again")}>
                <RotateCcw />
                Again
                <kbd className="ml-1 hidden rounded border border-border/60 px-1 font-mono text-[10px] text-muted-foreground sm:inline">2</kbd>
              </Button>
              <span className="ml-1 text-[12px] text-muted-foreground">Got it → next in {card.stage === 0 ? "7" : "30"} days · Again → 2 days</span>
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <p className="reading w-full text-[15px] text-muted-foreground">What does it mean? Say it to yourself, then check.</p>
            <Button size="sm" onClick={() => setRevealed(true)}>
              Show meaning
              <kbd className="ml-1 hidden rounded border border-white/30 px-1 font-mono text-[10px] sm:inline">space</kbd>
            </Button>
            {queue.length > 1 && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={later}>
                Later
                <kbd className="ml-1 hidden rounded border border-border/60 px-1 font-mono text-[10px] sm:inline">L</kbd>
              </Button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
