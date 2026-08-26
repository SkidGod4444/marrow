"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, isToolUIPart } from "ai";
import { Eye, MessageSquare, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput, PromptInputBody, PromptInputButton, PromptInputFooter, type PromptInputMessage, PromptInputSubmit, PromptInputTextarea, PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from "@/components/ai-elements/tool";
import { fmtTs, linkifyTimestamps } from "@/lib/time";
import { usePlayer } from "./player";
import { markdownComponents } from "./timestamp-link";

const SUGGESTIONS = ["What are the main claims, with timestamps?", "What's on screen right now?", "Which papers, tools, or people are mentioned?", "Where does the speaker disagree with common practice?"];

/**
 * PRD §6.1 per-video chat on AI Elements. Citations `[MM:SS]` are rendered as links that seek the player;
 * "What's on screen" sends the playback position so the model calls `view_frame` for that moment.
 */
export function Chat({ itemId, seed, onSeedConsumed }: { itemId: string; seed?: string | null; onSeedConsumed?: () => void }) {
  const { getCurrentTime } = usePlayer();
  const [input, setInput] = useState("");
  const transport = useMemo(() => new DefaultChatTransport({ api: `/api/marrow/items/${itemId}/chat` }), [itemId]);
  const { messages, sendMessage, status, error, setMessages, regenerate } = useChat({ id: `chat:${itemId}`, transport });

  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t) return;
      void sendMessage({ text: t }, { body: { playback_t: Math.floor(getCurrentTime()) } });
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

  return (
    <div className="flex h-[calc(100vh-12rem)] min-h-[480px] flex-col rounded-lg border border-border/70 bg-card">
      <Conversation className="flex-1">
        <ConversationContent>
          {messages.length === 0 ? (
            <ConversationEmptyState icon={<MessageSquare className="size-8 text-muted-foreground" />} title="Ask about this video" description="Answers cite timecodes. Click one to jump the player there." />
          ) : (
            messages.map((m) => <ChatMessage key={m.id} message={m} />)
          )}
          {error && <p className="text-sm text-destructive">{error.message}</p>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {messages.length === 0 && (
        <Suggestions className="border-t border-border/70 px-3 py-2">
          {SUGGESTIONS.map((s) => (
            <Suggestion key={s} suggestion={s} onClick={send} />
          ))}
        </Suggestions>
      )}

      <PromptInput onSubmit={onSubmit} className="m-2 border-border/70 shadow-none">
        <PromptInputBody>
          <PromptInputTextarea value={input} onChange={(e) => setInput(e.currentTarget.value)} placeholder="Ask about this video…" />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputButton tooltip="Send the current playback position" onClick={() => send(`What's on screen right now (at ${fmtTs(getCurrentTime())})? Describe it and relate it to what is being said.`)} disabled={busy}>
              <Eye className="size-4" />
              <span>What&apos;s on screen now</span>
            </PromptInputButton>
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
  const { seekTo } = usePlayer();
  if (name === "view_frame" && output && typeof output === "object" && "frame_id" in output) {
    const o = output as { frame_id: string; t: number; caption: string | null; ocr_text: string | null };
    return (
      <figure className="space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/marrow/frames/${o.frame_id}`} alt={o.caption ?? `Frame at ${fmtTs(o.t)}`} className="w-full cursor-pointer rounded border" onClick={() => seekTo(o.t)} />
        <figcaption className="text-xs text-muted-foreground">
          <button type="button" className="font-mono text-primary" onClick={() => seekTo(o.t)}>
            {fmtTs(o.t)}
          </button>
          {o.caption ? ` — ${o.caption}` : ""}
        </figcaption>
      </figure>
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
