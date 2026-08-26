"use client";

import { Maximize2, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtTs } from "@/lib/time";
import { usePlayer } from "./player";

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Our control bar: keycap buttons, a rail-style scrubber, timecode keycaps. Keyboard: space, ←/→ 5 s, J/L 10 s, M, F. */
export function PlayerControls() {
  const p = usePlayer();
  const [scrub, setScrub] = useState<number | null>(null);
  const shown = scrub ?? p.currentTime;
  const max = Math.max(1, p.duration || 1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.closest("[contenteditable=true]"))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === " ") p.toggle();
      else if (k === "arrowleft") p.seekBy(-5);
      else if (k === "arrowright") p.seekBy(5);
      else if (k === "j") p.seekBy(-10);
      else if (k === "l") p.seekBy(10);
      else if (k === "k") p.toggle();
      else if (k === "m") p.toggleMute();
      else if (k === "f") p.fullscreen();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  return (
    <div className="flex flex-col gap-2 border-t border-border/70 bg-card px-3 pb-2.5 pt-2" onDoubleClick={(e) => e.stopPropagation()}>
      <Slider
        aria-label="Seek"
        min={0}
        max={max}
        step={0.5}
        value={[shown]}
        onValueChange={(v) => setScrub(Array.isArray(v) ? (v[0] ?? 0) : (v as number))}
        onValueCommitted={(v) => {
          const t = Array.isArray(v) ? (v[0] ?? 0) : (v as number);
          setScrub(null);
          p.seekTo(t, p.playing);
        }}
        className="[&_[data-slot=slider-range]]:bg-time [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-time [&_[data-slot=slider-thumb]]:bg-time [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-border"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label={p.playing ? "Pause" : "Play"} onClick={p.toggle} disabled={!p.ready} />}>
            {p.playing ? <Pause /> : <Play />}
          </TooltipTrigger>
          <TooltipContent>{p.playing ? "Pause (space)" : "Play (space)"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Back 10 seconds" onClick={() => p.seekBy(-10)} disabled={!p.ready} />}>
            <RotateCcw />
          </TooltipTrigger>
          <TooltipContent>Back 10 s (J)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Forward 10 seconds" onClick={() => p.seekBy(10)} disabled={!p.ready} />}>
            <RotateCw />
          </TooltipTrigger>
          <TooltipContent>Forward 10 s (L)</TooltipContent>
        </Tooltip>
        <span className="ml-1 inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          <span className="timecode" data-live={p.playing || undefined}>
            {fmtTs(shown)}
          </span>
          <span>/</span>
          <span className="timecode">{fmtTs(p.duration)}</span>
          {p.buffering && <span className="ml-1 animate-pulse">buffering…</span>}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" aria-label="Playback speed" className="font-mono text-[11px]" />}>
              {p.rate}×
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[6rem]">
              {RATES.map((r) => (
                <DropdownMenuItem key={r} onClick={() => p.setRate(r)} className={`font-mono text-[12px] ${r === p.rate ? "text-foreground" : "text-muted-foreground"}`}>
                  {r}×
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label={p.muted ? "Unmute" : "Mute"} onClick={p.toggleMute} disabled={!p.ready} />}>
              {p.muted ? <VolumeX /> : <Volume2 />}
            </TooltipTrigger>
            <TooltipContent>{p.muted ? "Unmute (M)" : "Mute (M)"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" size="icon-sm" aria-label="Fullscreen" onClick={p.fullscreen} disabled={!p.ready} />}>
              <Maximize2 />
            </TooltipTrigger>
            <TooltipContent>Fullscreen (F)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
