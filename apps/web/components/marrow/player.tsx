"use client";

import { Play, RotateCcw } from "lucide-react";
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
  /** Has played at least once (poster shown until then). */
  started: boolean;
  ended: boolean;
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

export type FrameRef = { id: string; t: number };

/**
 * The visible player: video area + our control bar. YouTube's own chrome (title strip, share, "More videos",
 * "Watch on YouTube") only appears on the poster, paused and ended states — we cover those with our own layers
 * (thumbnail before first play; the nearest keyframe, dimmed, when paused/ended), and our transparent overlay
 * keeps hover away from the iframe while playing.
 */
export function PlayerFrame({ className = "", collapsed = false, frames = [] }: { className?: string; collapsed?: boolean; frames?: FrameRef[] }) {
  const host = useContext(HostContext);
  const p = usePlayer();
  if (!host) throw new Error("PlayerFrame must be used inside <PlayerProvider>");
  const poster = host.videoId ? `https://i.ytimg.com/vi/${host.videoId}/hqdefault.jpg` : null;
  const still = (() => {
    if (!frames.length) return poster;
    const nearest = frames.reduce((b, f) => (Math.abs(f.t - p.currentTime) < Math.abs(b.t - p.currentTime) ? f : b));
    return `/api/marrow/frames/${nearest.id}`;
  })();
  const showPoster = Boolean(host.videoId) && !p.started; // covers cued + initial buffering (YouTube shows its chrome there)
  const showPaused = Boolean(host.videoId) && p.started && !p.playing && !p.buffering;
  const loading = Boolean(host.videoId) && !p.started && p.buffering;

  return (
    <div ref={host.frameRef} className={`group/player flex flex-col overflow-hidden rounded-lg border border-border/70 bg-black [&:fullscreen]:rounded-none [&:fullscreen]:border-0 ${className}`}>
      {/* `collapsed` hides the picture but keeps the iframe mounted, so audio and the control bar keep working. */}
      <div className={`relative w-full [&:fullscreen]:flex-1 [&>div]:size-full [&_iframe]:size-full ${collapsed ? "h-0" : "aspect-video"}`}>
        <div ref={host.hostRef} className="size-full" />
        {collapsed ? null : host.videoId ? (
          <>
            {(showPoster || showPaused) && (
              <div className="absolute inset-0 bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {(showPoster ? poster : still) && <img src={(showPoster ? poster : still)!} alt="" className={`size-full object-cover ${showPaused ? "opacity-40" : "opacity-90"}`} draggable={false} />}
              </div>
            )}
            <button
              type="button"
              aria-label={p.playing ? "Pause" : p.ended ? "Replay" : "Play"}
              onClick={p.ended ? () => p.seekTo(0, true) : p.toggle}
              onDoubleClick={p.fullscreen}
              className="absolute inset-0 flex cursor-pointer items-center justify-center bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {(showPoster || showPaused) && (
                <span className="flex size-16 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white shadow-[0_8px_30px_rgb(0_0_0/0.6)] backdrop-blur-sm transition-transform group-hover/player:scale-105">
                  {loading ? <span className="size-6 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : p.ended ? <RotateCcw className="size-6" /> : <Play className="ml-1 size-7" fill="currentColor" />}
                </span>
              )}
            </button>
          </>
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
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
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
            setEnded(e.data === YT.PlayerState.ENDED);
            if (e.data === YT.PlayerState.PLAYING) {
              setStarted(true);
              setDuration(playerRef.current?.getDuration() ?? 0);
            }
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
    () => ({ seekTo, seekBy, getCurrentTime, toggle, play, pause, setRate, toggleMute, fullscreen, currentTime, duration, playing, buffering, started, ended, muted, rate, ready, hasVideo: Boolean(videoId) }),
    [seekTo, seekBy, getCurrentTime, toggle, play, pause, setRate, toggleMute, fullscreen, currentTime, duration, playing, buffering, started, ended, muted, rate, ready, videoId],
  );
  const hostValue = useMemo(() => ({ hostRef, frameRef, videoId }), [videoId]);
  return (
    <PlayerContext.Provider value={api}>
      <HostContext.Provider value={hostValue}>{children}</HostContext.Provider>
    </PlayerContext.Provider>
  );
}
