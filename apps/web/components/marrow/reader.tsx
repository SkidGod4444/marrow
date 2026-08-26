"use client";

import { Streamdown } from "streamdown";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PresentedDocument } from "@/lib/api";
import { fmtTs } from "@/lib/time";
import { ShareMenu } from "./share-menu";
import { Eyebrow, Rail, RailEntry, TimestampButton, markdownComponents } from "./timestamp-link";

/**
 * PRD §6.2 Reader: summary + takeaways on top, then sections on the timeline rail — each timecode seeks the
 * player — with an "ask about this section" affordance that opens chat pre-seeded with the section's span.
 */
export function Reader({ doc, onAsk, share = true }: { doc: PresentedDocument; onAsk?: (prompt: string) => void; share?: boolean }) {
  const article = doc.article;
  if (!article) {
    return <p className="py-10 text-sm text-muted-foreground">No article yet — the article stage hasn't run for this item.</p>;
  }
  return (
    <article className="space-y-10">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>Summary</Eyebrow>
          {share && <ShareMenu itemId={doc.id} title={doc.title} size="xs" />}
        </div>
        <p className="reading text-[19px] leading-[1.6]">{article.summary}</p>
      </section>

      {article.takeaways.length > 0 && (
        <section className="space-y-3">
          <Eyebrow>Takeaways</Eyebrow>
          <ul className="space-y-2 border-l border-border pl-4">
            {article.takeaways.map((t, i) => (
              <li key={i} className="reading text-[16px] leading-relaxed">
                {t}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Rail>
        {article.sections.map((s, i) => {
          const span = s.t_start !== null ? `${fmtTs(s.t_start)}${s.t_end ? `–${fmtTs(s.t_end)}` : ""}` : null;
          return (
            <RailEntry key={i} t={s.t_start} className="group py-5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <h3 className="reading text-[21px] font-semibold leading-snug tracking-tight">{s.heading}</h3>
                {onAsk && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-2 -mt-1 shrink-0 text-muted-foreground opacity-55 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                        aria-label={`Ask about "${s.heading}"`}
                        onClick={() => onAsk(`Explain the section "${s.heading}"${span ? ` (${span})` : ""} in more depth. What is the argument, and what evidence or examples are given?`)}
                      />
                    }
                  >
                    <MessageSquareText />
                  </TooltipTrigger>
                  <TooltipContent>Ask about this section</TooltipContent>
                </Tooltip>
                )}
              </div>
              <div className="md mt-2 text-[16.5px]">
                <Streamdown components={markdownComponents}>{s.body_md}</Streamdown>
              </div>
            </RailEntry>
          );
        })}
      </Rail>

      {doc.references.length > 0 && (
        <section className="space-y-3 border-t border-border/70 pt-8">
          <Eyebrow>References</Eyebrow>
          <ul className="space-y-1.5 text-sm">
            {doc.references.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2.5">
                {r.resolved_url ? (
                  <a href={r.resolved_url} target="_blank" rel="noreferrer" className="reading text-[15px] underline decoration-foreground/30 underline-offset-[3px] hover:decoration-foreground">
                    {r.name}
                  </a>
                ) : (
                  <span className="reading text-[15px]">{r.name}</span>
                )}
                <span className="font-mono text-[11px] text-muted-foreground">{r.kind}</span>
                {r.t !== null && r.t !== undefined && <TimestampButton t={r.t} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
