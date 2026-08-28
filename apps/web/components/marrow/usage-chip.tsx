"use client";

import type { ItemUsage } from "@marrow/core";
import { Coins } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { fmtMinutes, fmtTokens, fmtUsd } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/stages";

const label = (stage: string) => (stage === "summary" ? "Namespace summary" : (STAGE_LABEL[stage] ?? stage));

/** "$0.09 · 52k tokens" in the item's meta line; hover for the ledger — every stage and model, chat included. */
export function UsageChip({ usage }: { usage: ItemUsage }) {
  const t = usage.total;
  if (t.cost_usd === 0 && t.total_tokens === 0 && t.audio_seconds === 0) return null;
  const rows = [
    ...usage.stages.map((s) => ({ key: `${s.stage}|${s.model}`, what: label(s.stage), ...s })),
    ...(usage.chat.turns ? [{ key: "chat", what: `Chat · ${usage.chat.turns} turn${usage.chat.turns === 1 ? "" : "s"}`, model: "", ...usage.chat }] : []),
  ];
  return (
    <HoverCard>
      <HoverCardTrigger render={<button type="button" className="inline-flex items-center gap-1 rounded-md hover:text-foreground" aria-label="What this item cost" />}>
        <Coins className="size-3" />
        {fmtUsd(t.cost_usd)}
        {t.total_tokens > 0 && <span aria-hidden> · {fmtTokens(t.total_tokens)} tokens</span>}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-[min(92vw,34rem)] font-sans">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">API spend for this item — everything included</p>
        <div className="overflow-x-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="text-muted-foreground">
              <tr className="[&>th]:py-1 [&>th]:text-left [&>th]:font-normal">
                <th>Step</th>
                <th>Model</th>
                <th className="text-right!">In</th>
                <th className="text-right!">Out</th>
                <th className="text-right!">Audio</th>
                <th className="text-right!">Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-border/60 [&>td]:py-1">
                  <td className="pr-2">{r.what}</td>
                  <td className="pr-2 text-muted-foreground">{r.model}</td>
                  <td className="text-right">{r.input_tokens ? `${fmtTokens(r.input_tokens)}${r.cached_input_tokens ? ` (${fmtTokens(r.cached_input_tokens)} cached)` : ""}` : "—"}</td>
                  <td className="text-right">{r.output_tokens ? fmtTokens(r.output_tokens) : "—"}</td>
                  <td className="text-right">{r.audio_seconds ? fmtMinutes(r.audio_seconds) : "—"}</td>
                  <td className="text-right">{r.cost_usd.toFixed(4)}</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium [&>td]:py-1.5">
                <td>Total</td>
                <td />
                <td className="text-right">{fmtTokens(t.input_tokens)}</td>
                <td className="text-right">{fmtTokens(t.output_tokens)}</td>
                <td className="text-right">{t.audio_seconds ? fmtMinutes(t.audio_seconds) : "—"}</td>
                <td className="text-right">{fmtUsd(t.cost_usd)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">Pipeline runs and chat turns, at the provider&apos;s list prices; re-ingests add up. Web-search tool calls in chat are not itemised.</p>
      </HoverCardContent>
    </HoverCard>
  );
}
