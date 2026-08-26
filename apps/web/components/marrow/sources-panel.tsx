"use client";

import type { Source } from "@marrow/core";
import { ListPlus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDate } from "@/lib/time";

/** PRD §6.4 subscriptions: playlists/channels a namespace follows. Polled on a schedule; "Check now" polls immediately. */
export function SourcesPanel({ namespace, sources }: { namespace: string; sources: Source[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (label: string, path: string, init: RequestInit) => {
    setBusy(label);
    try {
      const res = await fetch(`/api/marrow/${path}`, init);
      const body = (await res.json().catch(() => ({}))) as { error?: string; poll?: { found: number; queued: string[] }; queued?: string[]; found?: number };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      const p = body.poll ?? (body.queued ? { found: body.found ?? 0, queued: body.queued } : null);
      if (p) toast.success(p.queued.length ? `${p.queued.length} new video${p.queued.length === 1 ? "" : "s"} queued` : "Nothing new", { description: `${p.found} entries checked` });
      else toast.success("Done");
      router.refresh();
      return true;
    } catch (err) {
      toast.error("Couldn't update subscriptions", { description: (err as Error).message });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    const ok = await call("add", "sources", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ namespace, url: url.trim() }) });
    if (ok) {
      setUrl("");
      setOpen(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Following</span>
      {sources.length === 0 && <span className="text-muted-foreground">nothing yet</span>}
      {sources.map((s) => (
        <span key={s.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 py-0.5 pl-2.5 pr-1">
          <span className="font-mono text-[10px] uppercase text-muted-foreground">{s.kind}</span>
          <a href={s.url} target="_blank" rel="noreferrer" className="max-w-[14rem] truncate hover:underline" title={s.url}>
            {s.title || s.url.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
          {s.lastError && (
            <Tooltip>
              <TooltipTrigger render={<span className="size-1.5 rounded-full bg-destructive" aria-label="Last poll failed" />} />
              <TooltipContent>{s.lastError}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger
              render={<Button variant="ghost" size="icon-xs" aria-label="Check now" disabled={busy !== null} onClick={() => void call(s.id, `sources/${s.id}/poll`, { method: "POST" })} />}
            >
              <RefreshCw className={busy === s.id ? "animate-spin" : ""} />
            </TooltipTrigger>
            <TooltipContent>Check for new uploads{s.lastCheckedAt ? ` · last checked ${fmtDate(s.lastCheckedAt)}` : ""}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="ghost" size="icon-xs" aria-label="Unfollow" disabled={busy !== null} onClick={() => void call(`rm-${s.id}`, `sources/${s.id}`, { method: "DELETE" })} />}>
              <Trash2 />
            </TooltipTrigger>
            <TooltipContent>Unfollow</TooltipContent>
          </Tooltip>
        </span>
      ))}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger render={<Button variant="outline" size="xs" />}>
          <ListPlus />
          Follow a playlist or channel
        </DialogTrigger>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={add} className="space-y-4">
            <DialogHeader>
              <DialogTitle className="reading">Follow in {namespace}</DialogTitle>
              <DialogDescription>Paste a YouTube playlist or channel URL. New uploads are ingested automatically; the first check runs now.</DialogDescription>
            </DialogHeader>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/playlist?list=… or /@channel" autoFocus aria-label="Playlist or channel URL" />
            <DialogFooter>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy !== null || !url.trim()}>
                {busy === "add" ? "Checking…" : "Follow"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
