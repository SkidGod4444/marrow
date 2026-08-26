"use client";

import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PresentedDocument } from "@/lib/api";
import { Chat } from "./chat";
import { Description } from "./description";
import { PlayerFrame, PlayerProvider, youtubeId } from "./player";
import { Reader } from "./reader";
import { Eyebrow, TimestampButton } from "./timestamp-link";
import { Transcript } from "./transcript";

/** Item page body: sticky player + chapters on the left, Reader / Chat / Transcript on the right (PRD §14 Phase 3). */
export function ItemView({ doc, initialT = null, initialTab = "reader" }: { doc: PresentedDocument; initialT?: number | null; initialTab?: "reader" | "chat" | "transcript" }) {
  const [tab, setTab] = useState<"reader" | "chat" | "transcript">(initialTab);
  const [seed, setSeed] = useState<string | null>(null);
  const ask = useCallback((prompt: string) => {
    setSeed(prompt);
    setTab("chat");
  }, []);
  const consumed = useCallback(() => setSeed(null), []);

  return (
    <PlayerProvider videoId={doc.source_type === "youtube_video" ? youtubeId(doc.source_url) : null} initialT={initialT}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,4fr)] lg:gap-10">
        <div className="space-y-5 lg:sticky lg:top-6 lg:self-start">
          <PlayerFrame />
          {doc.description.trim() && <Description text={doc.description} />}
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

        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="min-w-0 gap-6">
          <TabsList variant="line" className="w-full justify-start gap-4 border-b border-border/70">
            <TabsTrigger value="reader">Reader</TabsTrigger>
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="transcript">
              Transcript{doc.transcript_entries ? <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{doc.transcript_entries}</span> : null}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="reader">
            <Reader doc={doc} onAsk={ask} />
          </TabsContent>
          <TabsContent value="chat" keepMounted>
            <Chat endpoint={`items/${doc.id}/chat`} chatId={doc.id} mode="item" seed={seed} onSeedConsumed={consumed} />
          </TabsContent>
          <TabsContent value="transcript">
            <Transcript doc={doc} />
          </TabsContent>
        </Tabs>
      </div>
    </PlayerProvider>
  );
}
