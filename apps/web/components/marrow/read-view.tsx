"use client";

import { AlignLeft, Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { PresentedDocument } from "@/lib/api";
import { isTextKind, isWebUrl } from "@/lib/kind";
import { fmtDate, fmtTs } from "@/lib/time";
import { Markdown } from "./markdown";
import { PlayerFrame, PlayerProvider, youtubeId } from "./player";
import { Reader } from "./reader";
import { ShareMenu } from "./share-menu";
import { SpeakerDot } from "./speakers";
import { TimestampButton } from "./timestamp-link";

type Paragraph = { speaker: string; t_start: number; t_end: number; text: string };
const STORAGE_KEY = "marrow:shared-page:player";

/** The shared page: the item as a document — with the player (hideable; audio keeps going) and dialogue timecodes that seek it. */
export function ReadView({ doc }: { doc: PresentedDocument }) {
  const [showPlayer, setShowPlayer] = useState(true);
  const [showTranscript, setShowTranscript] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "hidden") setShowPlayer(false);
    } catch {
      /* private mode etc. */
    }
  }, []);
  const togglePlayer = () => {
    setShowPlayer((s) => {
      try {
        localStorage.setItem(STORAGE_KEY, s ? "hidden" : "shown");
      } catch {
        /* ignore */
      }
      return !s;
    });
  };

  const entries = doc.transcript ?? [];
  const paragraphs: Paragraph[] = [];
  for (const e of entries) {
    const text = e.text.trim();
    if (!text) continue;
    const last = paragraphs[paragraphs.length - 1];
    if (last && last.speaker === e.speaker && last.text.length + text.length < 700) {
      last.text += ` ${text}`;
      last.t_end = e.t_end;
    } else paragraphs.push({ speaker: e.speaker, t_start: e.t_start, t_end: e.t_end, text });
  }
  const speakers = doc.speakers;
  const labelOf = (id: string) => speakers.find((s) => s.id === id)?.label ?? id;
  const multi = new Set(entries.map((e) => e.speaker)).size > 1;
  const text = isTextKind(doc.source_type);
  const videoId = doc.source_type === "youtube_video" ? youtubeId(doc.source_url) : null;
  const audioSrc = !text && !videoId && doc.pipeline.stages_completed.includes("fetch") ? `/api/marrow/items/${doc.id}/audio` : null;
  const hasPlayer = Boolean(videoId || audioSrc);

  return (
    <PlayerProvider videoId={videoId} audioSrc={audioSrc}>
      <article className="mx-auto max-w-3xl space-y-8">
        <div data-no-print className="flex flex-wrap items-center justify-between gap-3">
          <Link href={`/items/${doc.id}`} className="text-[13px] text-muted-foreground hover:text-foreground">
            ← Open in Marrow
          </Link>
          <div className="flex items-center gap-2">
            {hasPlayer && (
              <Button variant="outline" size="sm" aria-pressed={showPlayer} onClick={togglePlayer}>
                {showPlayer ? <EyeOff /> : <Eye />}
                {showPlayer ? (videoId ? "Hide video" : "Hide player") : videoId ? "Show video" : "Show player"}
              </Button>
            )}
            <ShareMenu itemId={doc.id} title={doc.title} onSharedPage />
          </div>
        </div>

        <header className="space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{[...new Set([doc.author, doc.channel].filter(Boolean))].join(" · ") || "Shared from Marrow"}</p>
          <h1 className="reading text-[30px] font-semibold leading-[1.15] tracking-[-0.01em] sm:text-[34px]">{doc.title}</h1>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
            {doc.published_at && <span>{fmtDate(doc.published_at)}</span>}
            {doc.duration_s ? <span>{fmtTs(doc.duration_s)}</span> : null}
            {isWebUrl(doc.source_url) && (
              <a href={doc.source_url} target="_blank" rel="noreferrer" className="hover:text-foreground">
                {doc.source_url.replace(/^https?:\/\/(www\.)?/, "")}
              </a>
            )}
          </p>
        </header>

        {hasPlayer && (
          <div data-no-print>
            <PlayerFrame collapsed={!showPlayer} frames={doc.frames} />
          </div>
        )}

        {/* The article: AI-written summary, takeaways and topic sections — same as the Reader, without the chat affordance. */}
        <Reader doc={doc} share={false} />

        {/* Text items: the original text on request. Media: the full transcript as speaker-labelled dialogue. */}
        <section className="space-y-4 border-t border-border/70 pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              {text ? "Original text" : `Transcript${entries.length ? ` · ${entries.length} lines` : ""}`}
              {!text && multi ? ` · ${speakers.length} speakers` : ""}
            </p>
            {(text ? doc.body_md.trim().length > 0 : entries.length > 0) && (
              <Button variant="outline" size="xs" aria-expanded={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
                <AlignLeft />
                {showTranscript ? (text ? "Hide text" : "Hide transcript") : text ? "Show original text" : "Show full transcript"}
              </Button>
            )}
          </div>
          {showTranscript && text && <Markdown className="reading max-w-3xl text-[16px] leading-relaxed">{doc.body_md}</Markdown>}
          {showTranscript && multi && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <span>Speakers</span>
              {speakers.map((s, i) => (
                <span key={s.id} className="inline-flex items-center gap-1.5 normal-case tracking-normal">
                  <SpeakerDot index={i} />
                  <span className="font-sans text-[13px] text-foreground">{s.label}</span>
                </span>
              ))}
            </div>
          )}
          {showTranscript && (
            <div className="space-y-6">
              {paragraphs.map((p, i) => {
                const idx = Math.max(0, speakers.findIndex((s) => s.id === p.speaker));
                return (
                  <div key={i} className="grid gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-5">
                    <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:pt-1">
                      {videoId ? (
                        <TimestampButton t={p.t_start} />
                      ) : (
                        <Link href={`/items/${doc.id}?t=${Math.floor(p.t_start)}`} className="timecode" title="Open the video here">
                          {fmtTs(p.t_start)}
                        </Link>
                      )}
                      {multi && (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                          <SpeakerDot index={idx} />
                          <span className="truncate">{labelOf(p.speaker)}</span>
                        </span>
                      )}
                    </div>
                    <p className="reading text-[17px] leading-[1.7]">{p.text}</p>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </article>
    </PlayerProvider>
  );
}
