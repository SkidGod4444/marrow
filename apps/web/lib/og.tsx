import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";

// Shared OpenGraph rendering: the app's own look (charcoal, serif title, mono metadata, timecode keycaps).

export const OG_SIZE = { width: 1200, height: 630 };

const fontCache = new Map<string, Promise<ArrayBuffer | null>>();

/** Google Fonts TTF for Satori (which can't read woff2). Cached per process; returns null offline. */
export function googleFont(family: string, weight: number): Promise<ArrayBuffer | null> {
  const key = `${family}:${weight}`;
  if (!fontCache.has(key)) {
    fontCache.set(
      key,
      (async () => {
        try {
          const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&display=swap`, {
            headers: { "user-agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:12.0) Gecko/20100101 Firefox/12.0" }, // old UA → TTF
          }).then((r) => r.text());
          const url = /src:\s*url\(([^)]+\.(?:ttf|otf))\)/.exec(css)?.[1];
          if (!url) return null;
          return await fetch(url).then((r) => r.arrayBuffer());
        } catch {
          return null;
        }
      })(),
    );
  }
  return fontCache.get(key)!;
}

let markCache: Promise<string> | null = null;
export function markDataUrl(): Promise<string> {
  markCache ??= readFile(join(process.cwd(), "public", "brand", "marrow-mark.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`);
  return markCache;
}

export const OG = {
  bg: "#111111",
  panel: "#151515",
  well: "#20201F",
  hairline: "#2D2D2D",
  key: "#343434",
  fg: "#ececea",
  muted: "#9a9a96",
  time: "#e06c6c",
};

export function Keycap({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: 40,
        padding: "0 14px",
        borderRadius: 8,
        border: `2px solid ${live ? OG.time : "#4a4a4a"}`,
        background: live ? OG.time : `linear-gradient(180deg, ${OG.key}, ${OG.hairline})`,
        boxShadow: `0 4px 0 0 ${live ? "#7a2f2f" : OG.bg}`,
        color: live ? OG.bg : "#d6d6d3",
        fontFamily: "IBM Plex Mono",
        fontSize: 22,
      }}
    >
      {children}
    </div>
  );
}

export async function ogFonts() {
  const [serif, mono] = await Promise.all([googleFont("Source Serif 4", 600), googleFont("IBM Plex Mono", 400)]);
  return [
    ...(serif ? [{ name: "Source Serif 4", data: serif, weight: 600 as const, style: "normal" as const }] : []),
    ...(mono ? [{ name: "IBM Plex Mono", data: mono, weight: 400 as const, style: "normal" as const }] : []),
  ];
}

export async function renderOg(input: { eyebrow: string; title: string; meta?: string[]; timecodes?: string[]; footer?: string }) {
  const [fonts, mark] = await Promise.all([ogFonts(), markDataUrl()]);
  const title = input.title.length > 110 ? `${input.title.slice(0, 108)}…` : input.title;
  const titleSize = title.length > 70 ? 54 : title.length > 40 ? 64 : 76;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: OG.bg, color: OG.fg, padding: "56px 64px", fontFamily: "Source Serif 4" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={52} height={52} style={{ borderRadius: 12 }} alt="" />
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>Marrow</div>
          <div style={{ marginLeft: "auto", fontFamily: "IBM Plex Mono", fontSize: 20, color: OG.muted, letterSpacing: 3, textTransform: "uppercase" }}>{input.eyebrow}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, marginTop: 24 }}>
          <div style={{ fontSize: titleSize, fontWeight: 600, lineHeight: 1.12, letterSpacing: -1, display: "flex" }}>{title}</div>
          {input.meta?.length ? (
            <div style={{ display: "flex", gap: 28, marginTop: 26, fontFamily: "IBM Plex Mono", fontSize: 22, color: OG.muted }}>
              {input.meta.map((m, i) => (
                <div key={i} style={{ display: "flex" }}>
                  {m}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, position: "relative" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 19, height: 2, background: OG.hairline }} />
          {(input.timecodes ?? ["00:00", "12:34", "48:10"]).map((t, i) => (
            <Keycap key={i} live={i === 1}>
              {t}
            </Keycap>
          ))}
          {input.footer ? (
            <div style={{ marginLeft: "auto", fontFamily: "IBM Plex Mono", fontSize: 20, color: OG.muted, background: OG.bg, paddingLeft: 16 }}>{input.footer}</div>
          ) : null}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
