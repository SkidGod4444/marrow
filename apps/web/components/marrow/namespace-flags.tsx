"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Library: switch language mode on/off for a namespace (PRD §6.3 — expressions + clips are mined for its podcasts). */
export function LanguageModeToggle({ namespace, on }: { namespace: string; on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/marrow/namespaces/${encodeURIComponent(namespace)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ flags: { language_learning: !on } }) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? res.statusText);
      toast.success(on ? "Language mode off" : "Language mode on", { description: on ? "New items skip the expression pass." : "Podcasts and videos added from now on get an expression list with clips." });
      router.refresh();
    } catch (err) {
      toast.error("Couldn't change that", { description: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant={on ? "secondary" : "ghost"} size="xs" aria-pressed={on} disabled={busy} onClick={() => void toggle()} className={on ? "" : "text-muted-foreground"} />}>
        <Languages />
        {on ? "Language mode on" : "Language mode"}
      </TooltipTrigger>
      <TooltipContent>{on ? "Expressions and audio clips are mined from every podcast or video here. Click to turn off." : "Turn on to mine idioms, phrasal verbs and slang — with playable clips — from podcasts and videos in this namespace."}</TooltipContent>
    </Tooltip>
  );
}
