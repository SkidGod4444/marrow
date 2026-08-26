"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PlayerControls } from "./player-controls";

// YouTube IFrame API wrapper with the native controls hidden (`controls: 0`) and our own control bar.
// PRD §14 Phase 3: citations call `seekTo`; "what's on screen now" reads the position.

type YTPlayer = {
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  playVideo(): void;
  pauseVideo(): void;
  getPlayerState(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  destroy(): void;
};
type YTNamespace = { Player: new (el: HTMLElement, opts: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number } };

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
  seekBy: (delta: number) => void;
  getCurrentTime: () => number;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  setRate: (rate: number) => void;
  toggleMute: () => void;
  fullscreen: () => void;
  currentTime: number;
  duration: number;
  playing: boolean;
  buffering: boolean;
  muted: boolean;
  rate: number;
  ready: boolean;
  hasVideo: boolean;
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

/** The 11-character YouTube id, or null when the URL doesn't carry a real one (seeded demo items, other sources). */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const id = u.hostname.includes("youtu.be") ? u.pathname.slice(1) : u.searchParams.get("v");
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

const HostContext = createContext<{ hostRef: React.RefObject<HTMLDivElement | null>; frameRef: React.RefObject<HTMLDivElement | null>; videoId: string | null } | null>(null);

/** The visible player: video area (click = play/pause, double-click = fullscreen) + our control bar. */
export function PlayerFrame({ className = "" }: { className?: string }) {
  const host = useContext(HostContext);
  const player = usePlayer();
  if (!host) throw new Error("PlayerFrame must be used inside <PlayerProvider>");
  return (
    <div ref={host.frameRef} className={`group/player flex flex-col overflow-hidden rounded-lg border border-border/70 bg-black [&:fullscreen]:rounded-none [&:fullscreen]:border-0 ${className}`}>
      <div className="relative aspect-video w-full [&:fullscreen]:flex-1 [&>div]:size-full [&_iframe]:size-full">
        <div ref={host.hostRef} className="size-full" />
        {host.videoId ? (
          <button
            type="button"
            aria-label={player.playing ? "Pause" : "Play"}
            onClick={player.toggle}
            onDoubleClick={player.fullscreen}
            className="absolute inset-0 cursor-pointer bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">No embeddable player for this source</div>
        )}
      </div>
      {host.videoId && <PlayerControls />}
    </div>
  );
}

export function PlayerProvider({ videoId, initialT = null, children }: { videoId: string | null; initialT?: number | null; children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialT ?? 0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRateState] = useState(1);
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
        // Native controls off; we draw our own (PlayerControls). Keyboard handled by us too.
        playerVars: { controls: 0, disablekb: 1, rel: 0, modestbranding: 1, playsinline: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => {
            setReady(true);
            setDuration(playerRef.current?.getDuration() ?? 0);
            setMuted(playerRef.current?.isMuted() ?? false);
            const p = pendingSeek.current;
            if (p) {
              playerRef.current?.seekTo(p.t, true);
              if (p.play) playerRef.current?.playVideo();
              pendingSeek.current = null;
            }
          },
          onStateChange: (e: { data: number }) => {
            setPlaying(e.data === YT.PlayerState.PLAYING);
            setBuffering(e.data === YT.PlayerState.BUFFERING);
            if (e.data === YT.PlayerState.PLAYING) setDuration(playerRef.current?.getDuration() ?? 0);
          },
          onPlaybackRateChange: (e: { data: number }) => setRateState(e.data),
        },
      });
    });
    const tick = setInterval(() => {
      const p = playerRef.current;
      if (p && typeof p.getCurrentTime === "function") setCurrentTime(p.getCurrentTime() || 0);
    }, 250);
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
    frameRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [ready]);
  const getCurrentTime = useCallback(() => playerRef.current?.getCurrentTime() ?? 0, []);
  const play = useCallback(() => playerRef.current?.playVideo(), []);
  const pause = useCallback(() => playerRef.current?.pauseVideo(), []);
  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.getPlayerState() === 1) p.pauseVideo();
    else p.playVideo();
  }, []);
  const seekBy = useCallback(
    (delta: number) => {
      const p = playerRef.current;
      if (!p) return;
      const t = Math.max(0, Math.min((p.getDuration() || Number.POSITIVE_INFINITY) - 0.5, p.getCurrentTime() + delta));
      p.seekTo(t, true);
      setCurrentTime(t);
    },
    [],
  );
  const setRate = useCallback((r: number) => {
    playerRef.current?.setPlaybackRate(r);
    setRateState(r);
  }, []);
  const toggleMute = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (p.isMuted()) p.unMute();
    else p.mute();
    setMuted(!p.isMuted());
  }, []);
  const fullscreen = useCallback(() => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el.requestFullscreen?.();
  }, []);

  const api = useMemo<PlayerApi>(
    () => ({ seekTo, seekBy, getCurrentTime, toggle, play, pause, setRate, toggleMute, fullscreen, currentTime, duration, playing, buffering, muted, rate, ready, hasVideo: Boolean(videoId) }),
    [seekTo, seekBy, getCurrentTime, toggle, play, pause, setRate, toggleMute, fullscreen, currentTime, duration, playing, buffering, muted, rate, ready, videoId],
  );
  const hostValue = useMemo(() => ({ hostRef, frameRef, videoId }), [videoId]);
  return (
    <PlayerContext.Provider value={api}>
      <HostContext.Provider value={hostValue}>{children}</HostContext.Provider>
    </PlayerContext.Provider>
  );
}
