"use client";

import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PresentedDocument } from "@/lib/api";
import { isTextKind } from "@/lib/kind";
import { Chat } from "./chat";
import { Description } from "./description";
import { Markdown } from "./markdown";
import { PlayerFrame, PlayerProvider, youtubeId } from "./player";
import { Reader } from "./reader";
import { SourceCard } from "./source-card";
import { Eyebrow, TimestampButton } from "./timestamp-link";
import { Transcript } from "./transcript";

/** Item page body: sticky player + chapters on the left, Reader / Chat / Transcript on the right (PRD §14 Phase 3). */
export function ItemView({ doc, initialT = null, initialTab = "reader", className = "" }: { doc: PresentedDocument; initialT?: number | null; initialTab?: "reader" | "chat" | "transcript"; className?: string }) {
  const [tab, setTab] = useState<"reader" | "chat" | "transcript">(initialTab);
  const [seed, setSeed] = useState<string | null>(null);
  const ask = useCallback((prompt: string) => {
    setSeed(prompt);
    setTab("chat");
  }, []);
  const consumed = useCallback(() => setSeed(null), []);
  const text = isTextKind(doc.source_type);
  const videoId = doc.source_type === "youtube_video" ? youtubeId(doc.source_url) : null;
  // Podcast episodes / uploads: the pipeline's audio is streamed from the API (through the proxy) into our player.
  const audioSrc = !text && !videoId && doc.pipeline.stages_completed.includes("fetch") ? `/api/marrow/items/${doc.id}/audio` : null;

  return (
    <PlayerProvider videoId={videoId} audioSrc={audioSrc} initialT={initialT}>
      <div className={`grid gap-6 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] lg:gap-10 ${className}`}>
        {/* Left pane scrolls on its own (player stays near the top; long descriptions scroll under it). */}
        <div className="space-y-5 lg:min-h-0 lg:overflow-y-auto lg:pr-2">
          {text ? <SourceCard doc={doc} /> : <PlayerFrame frames={doc.frames} />}
          {!text && doc.description.trim() && <Description text={doc.description} />}
          {doc.chapters.length > 0 && (
            <div className="space-y-2">
              <Eyebrow>Chapters</Eyebrow>
              <ol className="flex flex-wrap gap-x-4 gap-y-1.5">
                {doc.chapters.map((c, i) => (
                  <li key={i} className="inline-flex items-center gap-1.5 text-[13px]">
                    <TimestampButton t={c.t_start} />
                    <span className="max-w-[16rem] truncate text-foreground/85">{c.title}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        {/* Right pane: tab list stays put; each tab's content scrolls inside the pane. */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="min-w-0 gap-6 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
          <TabsList variant="line" className="w-full shrink-0 justify-start gap-4 border-b border-border/70">
            <TabsTrigger value="reader">Reader</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="transcript">
              {text ? "Text" : "Transcript"}
              {!text && doc.transcript_entries ? <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{doc.transcript_entries}</span> : null}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="reader" className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
            <Reader doc={doc} onAsk={ask} />
          </TabsContent>
          {/* keepMounted panels get the `hidden` attribute when inactive; keep that winning over lg:flex. */}
          <TabsContent value="chat" keepMounted className="lg:min-h-0 lg:flex-1 lg:flex lg:flex-col [&[hidden]]:hidden!">
            <Chat endpoint={`items/${doc.id}/chat`} chatId={doc.id} mode="item" seed={seed} onSeedConsumed={consumed} className="lg:h-full lg:min-h-0" />
          </TabsContent>
          <TabsContent value="transcript" className="lg:min-h-0 lg:flex-1 lg:flex lg:flex-col">
            {text ? (
              <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
                <Markdown className="reading max-w-3xl text-[16px] leading-relaxed">{doc.body_md}</Markdown>
              </div>
            ) : (
              <Transcript doc={doc} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </PlayerProvider>
  );
}
