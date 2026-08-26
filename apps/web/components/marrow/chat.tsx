"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, isToolUIPart } from "ai";
import { Eye, MessageSquare, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Button } from "@/components/ui/button";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, type PromptInputMessage, PromptInputSubmit, PromptInputTextarea, PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { fmtTs, linkifyTimestamps } from "@/lib/time";
import { usePlayerOptional } from "./player";
import { markdownComponents } from "./timestamp-link";

const ITEM_SUGGESTIONS = ["What are the main claims, with timestamps?", "What's on screen right now?", "Which papers, tools, or people are mentioned?", "Where does the speaker disagree with common practice?"];
const NAMESPACE_SUGGESTIONS = ["What does this corpus cover, and where do the sources disagree?", "Compare how different videos treat the same technique.", "Which papers come up most, and what is said about them?", "What should I watch next, given what's here?"];

/**
 * PRD §6.1 per-video chat on AI Elements. Citations `[MM:SS]` are rendered as links that seek the player;
 * "What's on screen" sends the playback position so the model calls `view_frame` for that moment.
 */
export type ChatProps = {
  /** Item chat: `items/<id>/chat` (needs a player around it). Namespace chat: `namespaces/<name>/chat` (no player). */
  endpoint: string;
  chatId: string;
  mode: "item" | "namespace";
  seed?: string | null;
  onSeedConsumed?: () => void;
  className?: string;
};

export function Chat({ endpoint, chatId, mode, seed, onSeedConsumed, className = "" }: ChatProps) {
  const player = usePlayerOptional();
  const getCurrentTime = player?.getCurrentTime;
  const [input, setInput] = useState("");
  const transport = useMemo(() => new DefaultChatTransport({ api: `/api/marrow/${endpoint}` }), [endpoint]);
  const { messages, sendMessage, status, error, setMessages, regenerate } = useChat({ id: `chat:${chatId}`, transport });

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      void sendMessage({ text: t }, getCurrentTime ? { body: { playback_t: Math.floor(getCurrentTime()) } } : undefined);
      setInput("");
    },
    [sendMessage, getCurrentTime],
  );

  useEffect(() => {
    if (seed) {
      send(seed);
      onSeedConsumed?.();
    }
  }, [seed, send, onSeedConsumed]);

  const onSubmit = (m: PromptInputMessage) => send(m.text);
  const busy = status === "submitted" || status === "streaming";
  const suggestions = mode === "item" ? ITEM_SUGGESTIONS : NAMESPACE_SUGGESTIONS;

  return (
    <div className={`flex h-[70vh] min-h-[420px] flex-col rounded-lg border border-border/70 bg-card ${className}`}>
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState
              icon={<MessageSquare className="size-8 text-muted-foreground" />}
              title={mode === "item" ? "Ask about this video" : "Ask across the namespace"}
              description={mode === "item" ? "Answers cite timecodes. Click one to jump the player there." : "Answers cite videos at the moment they say it. Click a citation to open it there."}
            />
          ) : (
            messages.map((m) => <ChatMessage key={m.id} message={m} />)
          )}
          {error && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              <span className="text-destructive">Couldn&apos;t get an answer just now.</span>
              <Button variant="outline" size="xs" onClick={() => void regenerate()}>
                Try again
              </Button>
            </div>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {messages.length === 0 && (
        <Suggestions className="border-t border-border/70 px-3 py-2">
          {suggestions.map((s) => (
            <Suggestion key={s} suggestion={s} onClick={send} />
          ))}
        </Suggestions>
      )}

      <PromptInput onSubmit={onSubmit} className="m-2 border-border/70 shadow-none">
        <PromptInputBody>
          <PromptInputTextarea value={input} onChange={(e) => setInput(e.currentTarget.value)} placeholder={mode === "item" ? "Ask about this video…" : "Ask across every video in this namespace…"} />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            {getCurrentTime && (
              <PromptInputButton tooltip="Send the current playback position" onClick={() => send(`What's on screen right now (at ${fmtTs(getCurrentTime())})? Describe it and relate it to what is being said.`)} disabled={busy}>
                <Eye className="size-4" />
                <span className="hidden sm:inline">What&apos;s on screen now</span>
              </PromptInputButton>
            )}
            {messages.length > 0 && (
              <>
                <PromptInputButton tooltip="Regenerate the last answer" onClick={() => void regenerate()} disabled={busy}>
                  <RotateCcw className="size-4" />
                </PromptInputButton>
                <PromptInputButton tooltip="Clear the conversation" onClick={() => setMessages([])} disabled={busy}>
                  Clear
                </PromptInputButton>
              </>
            )}
          </PromptInputTools>
          <PromptInputSubmit status={status} disabled={!input.trim() && !busy} />
        </PromptInputFooter>
      </PromptInput>
    </div>
  );
}

function ChatMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, i) => {
          const key = `${message.id}-${i}`;
          if (part.type === "text") {
            return isUser ? (
              <p key={key} className="whitespace-pre-wrap">{part.text}</p>
            ) : (
              <MessageResponse key={key} className="md text-[15.5px]" components={markdownComponents}>
                {linkifyTimestamps(part.text)}
              </MessageResponse>
            );
          }
          if (part.type === "reasoning") {
            return (
              <Reasoning key={key} isStreaming={part.state === "streaming"}>
                <ReasoningTrigger />
                <ReasoningContent>{part.text}</ReasoningContent>
              </Reasoning>
            );
          }
          if (isToolUIPart(part) && part.type !== "dynamic-tool") {
            const name = part.type.replace(/^tool-/, "");
            const output = part.state === "output-available" ? part.output : undefined;
            return (
              <Tool key={key} defaultOpen={name === "view_frame"}>
                <ToolHeader type={part.type} state={part.state} />
                <ToolContent>
                  <ToolInput input={part.input} />
                  <ToolOutput errorText={part.errorText} output={output === undefined ? undefined : <ToolResult name={name} output={output} />} />
                </ToolContent>
              </Tool>
            );
          }
          return null;
        })}
      </MessageContent>
    </Message>
  );
}

function ToolResult({ name, output }: { name: string; output: unknown }) {
  const player = usePlayerOptional();
  if (name === "view_frame" && output && typeof output === "object" && "frame_id" in output) {
    const o = output as { frame_id: string; t: number; caption: string | null; ocr_text: string | null };
    const jump = player ? () => player.seekTo(o.t) : undefined;
    return (
      <figure className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/marrow/frames/${o.frame_id}`} alt={o.caption ?? `Frame at ${fmtTs(o.t)}`} className={`w-full rounded border ${jump ? "cursor-pointer" : ""}`} onClick={jump} />
        <figcaption className="text-xs text-muted-foreground">
          {jump ? (
            <button type="button" className="timecode" onClick={jump}>
              {fmtTs(o.t)}
            </button>
          ) : (
            <span className="timecode">{fmtTs(o.t)}</span>
          )}
          {o.caption ? ` — ${o.caption}` : ""}
        </figcaption>
      </figure>
    );
  }
  if (name === "search" && Array.isArray(output)) {
    const hits = output as Array<{ item_id: string; title: string; t_start: number | null; timestamp: string | null; link: string; text: string }>;
    return (
      <ul className="space-y-1.5 text-xs">
        {hits.slice(0, 8).map((h, i) => (
          <li key={i} className="flex items-start gap-2">
            {h.timestamp && <span className="timecode shrink-0">{h.timestamp}</span>}
            <span className="min-w-0">
              <a href={h.link} className="font-medium hover:underline">{h.title}</a>
              <span className="block truncate text-muted-foreground">{h.text}</span>
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (name === "fetch_url" && output && typeof output === "object" && "text" in output) {
    const o = output as { url: string; status: number; text: string };
    return (
      <div className="space-y-1 text-xs">
        <a href={o.url} target="_blank" rel="noreferrer" className="underline">{o.url}</a>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-muted-foreground">{o.text.slice(0, 1500)}{o.text.length > 1500 ? "…" : ""}</pre>
      </div>
    );
  }
  return <pre className="max-h-48 overflow-auto text-xs">{JSON.stringify(output, null, 2)}</pre>;
}
