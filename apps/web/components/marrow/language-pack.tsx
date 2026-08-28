"use client";

import type { ExpressionView } from "@marrow/core";
import { BookmarkCheck, BookmarkPlus, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fmtDate } from "@/lib/time";
import { usePlayerOptional } from "./player";
import { Eyebrow, TimestampButton } from "./timestamp-link";

const KIND: Record<string, string> = { idiom: "idiom", phrasal_verb: "phrasal verb", collocation: "collocation", slang: "slang", other: "expression" };

/** One shared <audio> for the whole list; playing a clip stops the previous one. */
function useClipPlayer() {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  useEffect(() => {
    const el = new Audio();
    el.preload = "none";
    const stop = () => setPlaying(null);
    el.addEventListener("ended", stop);
    el.addEventListener("error", () => {
      stop();
      toast.error("Couldn't play that clip");
    });
    ref.current = el;
    return () => {
      el.pause();
      el.removeAttribute("src");
      ref.current = null;
    };
  }, []);
  const toggle = (n: number, url: string) => {
    const el = ref.current;
    if (!el) return;
    if (playing === n) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.src = url;
    el.currentTime = 0;
    void el.play().then(() => setPlaying(n)).catch(() => toast.error("Couldn't play that clip"));
  };
  return { playing, toggle };
}

/** PRD §6.3 language mode: expression · meaning · play the exact clip · jump to the moment · learn (review queue). */
export function LanguagePack({ itemId, initial }: { itemId: string; initial: ExpressionView[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const player = usePlayerOptional();
  const clips = useClipPlayer();

  const learn = async (row: ExpressionView) => {
    setBusy(row.n);
    try {
      const res = await fetch(`/api/marrow/items/${itemId}/expressions/${row.n}/save`, { method: row.saved ? "DELETE" : "POST" });
      const body = (await res.json().catch(() => ({}))) as { review?: { dueAt: string }; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setRows((rs) => rs.map((r) => (r.n === row.n ? { ...r, saved: !row.saved, due_at: row.saved ? null : (body.review?.dueAt ?? null) } : r)));
      if (row.saved) toast("Removed from review");
      else toast.success("Added to review", { description: "It comes back as a recall prompt in 2 days, then 7, then 30." });
      window.dispatchEvent(new Event("marrow:reviews-changed"));
    } catch (err) {
      toast.error("Couldn't update review", { description: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const saved = rows.filter((r) => r.saved).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Eyebrow>Expressions</Eyebrow>
        <p className="font-mono text-[11px] text-muted-foreground">
          {rows.length} found · {saved} in review
        </p>
      </div>
      <p className="reading text-[15px] text-muted-foreground">Idioms, phrasal verbs and turns of phrase from this episode. Play the exact clip, jump to the moment, or mark one to learn — it comes back as a recall prompt.</p>
      <ol className="divide-y divide-border/70 border-y border-border/70">
        {rows.map((r) => {
          const playing = clips.playing === r.n;
          return (
            <li key={r.n} className="grid gap-x-4 gap-y-2 py-3.5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
              <div className="flex items-center gap-1.5 sm:pt-0.5">
                {r.clip_url ? (
                  <Button variant="outline" size="icon-sm" aria-label={playing ? `Stop clip: ${r.text}` : `Play clip: ${r.text}`} aria-pressed={playing} onClick={() => clips.toggle(r.n, `/api/marrow${r.clip_url}`)}>
                    {playing ? <Square className="size-3" fill="currentColor" /> : <Play className="ml-px size-3.5" fill="currentColor" />}
                  </Button>
                ) : (
                  <span className="inline-flex size-7 items-center justify-center font-mono text-[10px] text-muted-foreground" title="No clip for this one">—</span>
                )}
                {player ? (
                  <TimestampButton t={r.t_start} />
                ) : (
                  <a href={r.deep_link} target="_blank" rel="noreferrer" className="timecode">
                    {Math.floor(r.t_start / 60)}:{String(Math.floor(r.t_start % 60)).padStart(2, "0")}
                  </a>
                )}
              </div>
              <div className="min-w-0">
                <p className="reading text-[17px] font-medium leading-snug">
                  {r.text}
                  <span className="ml-2 align-middle rounded-md border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground">{KIND[r.kind] ?? r.kind}</span>
                </p>
                <p className="reading mt-1 text-[15px] leading-relaxed text-foreground/85">{r.explanation}</p>
                {r.saved && r.due_at && <p className="mt-1 font-mono text-[11px] text-muted-foreground">in review · next {fmtDate(r.due_at)}</p>}
              </div>
              <div className="sm:pt-0.5">
                <Button variant={r.saved ? "secondary" : "outline"} size="sm" disabled={busy === r.n} aria-pressed={r.saved} onClick={() => void learn(r)}>
                  {r.saved ? <BookmarkCheck /> : <BookmarkPlus />}
                  {r.saved ? "Learning" : "Learn"}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
