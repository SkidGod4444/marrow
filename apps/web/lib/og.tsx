import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import type { ReactNode } from "react";
import { BRAIN_ASCII } from "./brain-ascii";

// Shared OpenGraph rendering: the app's own look (charcoal, serif title, mono metadata, timecode keycaps).

export const OG_SIZE = { width: 1200, height: 630 };

const fontCache = new Map<string, Promise<ArrayBuffer | null>>();

/** WOFF files checked in under apps/web/assets/fonts (from @fontsource; Satori reads TTF/OTF/WOFF) — no network at render time. */
export function localFont(relPath: string): Promise<ArrayBuffer | null> {
  if (!fontCache.has(relPath)) {
    fontCache.set(
      relPath,
      readFile(join(process.cwd(), "assets", relPath))
        .then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer)
        .catch(() => null),
    );
  }
  return fontCache.get(relPath)!;
}

let markCache: Promise<string> | null = null;
export function markDataUrl(): Promise<string> {
  markCache ??= readFile(join(process.cwd(), "assets", "brand", "marrow-mark.png")).then((b) => `data:image/png;base64,${b.toString("base64")}`);
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
  const [serif, mono] = await Promise.all([
    localFont("fonts/source-serif-4-latin-600-normal.woff"),
    localFont("fonts/ibm-plex-mono-latin-400-normal.woff"),
  ]);
  return [
    ...(serif ? [{ name: "Source Serif 4", data: serif, weight: 600 as const, style: "normal" as const }] : []),
    ...(mono ? [{ name: "IBM Plex Mono", data: mono, weight: 400 as const, style: "normal" as const }] : []),
  ];
}

export async function renderOg(input: { eyebrow: string; title: string; meta?: string[]; timecodes?: string[]; footer?: string; muted?: string }) {
  const [fonts, mark] = await Promise.all([ogFonts(), markDataUrl()]);
  const title = input.title.length > 110 ? `${input.title.slice(0, 108)}…` : input.title;
  const titleSize = title.length > 70 ? 50 : title.length > 40 ? 58 : 68;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: OG.bg, color: OG.fg, padding: "52px 60px", fontFamily: "Source Serif 4", position: "relative" }}>
        {/* the brain, in type, behind the right half */}
        <div
          style={{
            position: "absolute",
            right: 44,
            top: 168,
            fontFamily: "IBM Plex Mono",
            fontSize: 11.6,
            lineHeight: 1.0,
            whiteSpace: "pre",
            color: "#9a9a96",
            opacity: 0.8,
            display: "flex",
          }}
        >
          {BRAIN_ASCII}
        </div>
        <div style={{ position: "absolute", left: 0, top: 0, width: 760, height: 630, background: "linear-gradient(90deg, #111111 62%, rgba(17,17,17,0))", display: "flex" }} />
        <div style={{ display: "flex", alignItems: "center", gap: 16, position: "relative" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={46} height={46} style={{ borderRadius: 11 }} alt="" />
          <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>Marrow</div>
          <div style={{ marginLeft: 26, fontFamily: "IBM Plex Mono", fontSize: 17, color: OG.muted, letterSpacing: 3, textTransform: "uppercase", display: "flex" }}>{input.eyebrow}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", flex: 1, marginTop: 20, position: "relative", maxWidth: 740 }}>
          {input.muted ? <div style={{ fontSize: titleSize, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1, display: "flex", color: OG.muted }}>{input.muted}</div> : null}
          <div style={{ fontSize: titleSize, fontWeight: 600, lineHeight: 1.1, letterSpacing: -1, display: "flex" }}>{title}</div>
          {input.meta?.length ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginTop: 24, fontFamily: "IBM Plex Mono", fontSize: 17, color: OG.muted }}>
              {input.meta.map((m, i) => (
                <div key={i} style={{ display: "flex" }}>
                  {m}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
          {(input.timecodes ?? []).map((t, i) => (
            <Keycap key={i} live={i === 1}>
              {t}
            </Keycap>
          ))}
          {input.footer ? (
            <div style={{ marginLeft: input.timecodes?.length ? 18 : 0, fontFamily: "IBM Plex Mono", fontSize: 18, color: OG.muted, display: "flex" }}>{input.footer}</div>
          ) : null}
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts },
  );
}
