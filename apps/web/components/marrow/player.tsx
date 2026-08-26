"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

// Minimal YouTube IFrame API wrapper (PRD §14 Phase 3: citations call `seekTo`; "what's on screen now" reads the position).

type YTPlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  playVideo(): void;
  getPlayerState(): number;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number } };

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return new Promise(() => undefined);
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT!);
      };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      s.async = true;
      document.head.appendChild(s);
    });
  }
  return apiPromise;
}

export type PlayerApi = {
  seekTo: (t: number, play?: boolean) => void;
  getCurrentTime: () => number;
  currentTime: number;
  ready: boolean;
};

const PlayerContext = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used inside <PlayerProvider>");
  return ctx;
}

/** Same as usePlayer but returns null outside a provider (namespace chat has no player). */
export function usePlayerOptional(): PlayerApi | null {
  return useContext(PlayerContext);
}

export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1) || null;
    return u.searchParams.get("v");
  } catch {
    return null;
  }
}

const HostContext = createContext<{ hostRef: React.RefObject<HTMLDivElement | null>; videoId: string | null } | null>(null);

/** The visible player. Place it anywhere inside <PlayerProvider>; the provider mounts the YouTube iframe into it. */
export function PlayerFrame({ className = "" }: { className?: string }) {
  const host = useContext(HostContext);
  if (!host) throw new Error("PlayerFrame must be used inside <PlayerProvider>");
  return (
    <div ref={host.hostRef} className={`aspect-video w-full overflow-hidden rounded-lg border bg-black [&>div]:size-full [&_iframe]:size-full ${className}`}>
      {!host.videoId && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No embeddable player for this source</div>}
    </div>
  );
}

export function PlayerProvider({ videoId, initialT = null, children }: { videoId: string | null; initialT?: number | null; children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialT ?? 0);
  const pendingSeek = useRef<{ t: number; play: boolean } | null>(initialT !== null ? { t: initialT, play: false } : null);

  useEffect(() => {
    if (!videoId || !hostRef.current) return;
    let cancelled = false;
    const host = hostRef.current;
    host.replaceChildren();
    const mount = document.createElement("div");
    host.appendChild(mount);
    loadYouTubeApi().then((YT) => {
      if (cancelled) return;
      playerRef.current = new YT.Player(mount, {
        videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onReady: () => {
            setReady(true);
            const p = pendingSeek.current;
            if (p) {
              playerRef.current?.seekTo(p.t, true);
              if (p.play) playerRef.current?.playVideo();
              pendingSeek.current = null;
            }
          },
        },
      });
    });
    const tick = setInterval(() => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === "function") setCurrentTime(p.getCurrentTime() || 0);
    }, 500);
    return () => {
      cancelled = true;
      clearInterval(tick);
      playerRef.current?.destroy();
      playerRef.current = null;
      mount.remove();
    };
  }, [videoId]);

  const seekTo = useCallback((t: number, play = true) => {
    const p = playerRef.current;
    if (!p || !ready) {
      pendingSeek.current = { t, play };
      return;
    }
    p.seekTo(t, true);
    if (play) p.playVideo();
    setCurrentTime(t);
    hostRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [ready]);

  const getCurrentTime = useCallback(() => playerRef.current?.getCurrentTime() ?? 0, []);
  const api = useMemo<PlayerApi>(() => ({ seekTo, getCurrentTime, currentTime, ready }), [seekTo, getCurrentTime, currentTime, ready]);

  const hostValue = useMemo(() => ({ hostRef, videoId }), [videoId]);
  return (
    <PlayerContext.Provider value={api}>
      <HostContext.Provider value={hostValue}>{children}</HostContext.Provider>
    </PlayerContext.Provider>
  );
}
