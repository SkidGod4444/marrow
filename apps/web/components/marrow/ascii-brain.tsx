"use client";

import { useEffect, useRef } from "react";

// The brain from the owner's image, drawn in ASCII on a canvas: every grid cell takes a character by how bright the
// image is there, in the image's own colour. It breathes rather than spins — a band of light sweeps slowly across the
// folds, the whole thing floats a little, and neurons fire: cells flare white and fade. Reduced motion gets one still frame.

const RAMP = " .,:;-=+*x#%@";

export function AsciiBrain({ src = "/landing/brain.png", className, cell = 6, opacity = 0.9 }: { src?: string; className?: string; cell?: number; opacity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const img = new Image();
    img.decoding = "async";
    let cols = 0, rows = 0, dpr = 1, w = 0, h = 0, cellPx = cell;
    let lum = new Float32Array(0), alpha = new Float32Array(0), spark = new Float32Array(0), hue = new Float32Array(0), sat = new Float32Array(0);
    let ready = false;
    // neurons firing: a few cells at a time flare white and fade over half a second, their neighbours faintly with them
    type Spark = { i: number; t0: number; life: number };
    let sparks: Spark[] = [];
    let nextSpawn = 0;
    const spawn = (t: number) => {
      for (let tries = 0; tries < 12; tries++) {
        const i = Math.floor(Math.random() * cols * rows);
        if (alpha[i]! > 0.6 && lum[i]! > 0.12) { sparks.push({ i, t0: t, life: 450 + Math.random() * 500 }); return; }
      }
    };

    // Sample the image once per size: each character cell is the average of a 4×4 patch of the (contrast-boosted)
    // image, then an S-curve so fissures read as gaps and ridges as bright glyphs.
    const SS = 4;
    const sample = () => {
      const rect = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width)); h = Math.max(1, Math.round(rect.height));
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = w * dpr; canvas.height = h * dpr;
      cellPx = w < 560 ? cell + 1 : cell;
      cols = Math.floor(w / cellPx); rows = Math.floor(h / cellPx);
      const off = document.createElement("canvas");
      off.width = cols * SS; off.height = rows * SS;
      const octx = off.getContext("2d");
      if (!octx) return;
      const k = Math.min(off.width / img.width, off.height / img.height);
      const dw = img.width * k, dh = img.height * k;
      octx.clearRect(0, 0, off.width, off.height);
      octx.drawImage(img, (off.width - dw) / 2, (off.height - dh) / 2, dw, dh);
      const data = octx.getImageData(0, 0, off.width, off.height).data;
      const n = cols * rows;
      lum = new Float32Array(n); alpha = new Float32Array(n); spark = new Float32Array(n); hue = new Float32Array(n); sat = new Float32Array(n); sparks = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let sum = 0, aSum = 0, cnt = 0, R = 0, G = 0, B = 0;
          for (let dy = 0; dy < SS; dy++) {
            for (let dx = 0; dx < SS; dx++) {
              const p = ((r * SS + dy) * off.width + (c * SS + dx)) * 4;
              const a = data[p + 3]! / 255;
              aSum += a;
              if (a < 0.5) continue;
              const l = (0.2126 * data[p]! + 0.7152 * data[p + 1]! + 0.0722 * data[p + 2]!) / 255;
              sum += l; cnt++; R += data[p]!; G += data[p + 1]!; B += data[p + 2]!;
            }
          }
          const i = r * cols + c;
          alpha[i] = aSum / (SS * SS);
          if (!cnt) { lum[i] = 0; continue; }
          lum[i] = sum / cnt;
          R /= cnt; G /= cnt; B /= cnt;
          const cmx = Math.max(R, G, B), cmn = Math.min(R, G, B), d = cmx - cmn;
          sat[i] = cmx > 0 ? d / cmx : 0;
          hue[i] = d === 0 ? 0 : cmx === R ? 60 * (((G - B) / d) % 6) : cmx === G ? 60 * ((B - R) / d + 2) : 60 * ((R - G) / d + 4);
        }
      }
      // stretch the tones so a mid-grey image fills the ramp as well as a bright one does
      let lo = 1, hi = 0;
      for (let i = 0; i < n; i++) if (alpha[i]! > 0.5) { if (lum[i]! < lo) lo = lum[i]!; if (lum[i]! > hi) hi = lum[i]!; }
      // stretch to the image's own range, then an S-curve: fissures fall to black, ridges rise to white
      if (hi > lo + 0.05) for (let i = 0; i < n; i++) { const t = (lum[i]! - lo) / (hi - lo); lum[i] = Math.min(1, Math.max(0, (t - 0.5) * 1.7 + 0.5)); }
      ready = true;
    };

    const frame = (t: number) => {
      if (!ready || !cols || !rows) return;
      const sweep = ((t * 0.00009) % 1.6) * (cols + rows) - rows * 0.3; // a diagonal band of light, once every ~18 s
      const floatY = Math.sin(t * 0.0006) * 6;
      if (!reduce) {
        while (t > nextSpawn) { spawn(t); nextSpawn = Math.max(t, nextSpawn) + 90 + Math.random() * 180; }
        sparks = sparks.filter((sp) => t - sp.t0 < sp.life);
        spark.fill(0);
        for (const sp of sparks) {
          const k = 1 - (t - sp.t0) / sp.life;
          const v = k * k;
          spark[sp.i] = Math.max(spark[sp.i]!, v);
          const c0 = sp.i % cols, r0 = (sp.i - c0) / cols;
          if (c0 > 0) spark[sp.i - 1] = Math.max(spark[sp.i - 1]!, v * 0.45);
          if (c0 < cols - 1) spark[sp.i + 1] = Math.max(spark[sp.i + 1]!, v * 0.45);
          if (r0 > 0) spark[sp.i - cols] = Math.max(spark[sp.i - cols]!, v * 0.45);
          if (r0 < rows - 1) spark[sp.i + cols] = Math.max(spark[sp.i + cols]!, v * 0.45);
        }
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, floatY * dpr);
      ctx.clearRect(0, -12, w, h + 24);
      ctx.font = `${cellPx * 1.1}px "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textBaseline = "top";
      const last = RAMP.length - 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const a = alpha[i]!;
          if (a < 0.08) continue;
          const dist = c + r - sweep;
          const glow = Math.exp(-(dist * dist) / 90); // the band, ~10 cells wide
          const l = Math.min(1, lum[i]! * (0.82 + 0.45 * glow));
          if (l < 0.07) continue; // a fissure: leave the cell empty // every cell inside the brain gets at least a dot
          // the image's blue, kept saturated: shadows deep, highlights icy; the sweep lifts the lightness a touch
          const sp = spark[i]!;
          if (sp > 0.05) {
            ctx.fillStyle = `hsl(${hue[i]} ${Math.min(100, sat[i]! * 120)}% ${74 + 24 * sp}% / ${Math.min(1, 0.55 + sp) * a})`;
            ctx.fillText(sp > 0.5 ? "@" : "*", c * cellPx, r * cellPx);
            continue;
          }
          const sMax = Math.min(96, sat[i]! * 130); // lift a saturated image's colour, leave a grey one grey
          ctx.fillStyle = `hsl(${hue[i]} ${sMax}% ${48 + 34 * l + 10 * glow}% / ${(0.7 + 0.3 * l) * a * opacity})`;
          ctx.fillText(RAMP[Math.round(l * last)]!, c * cellPx, r * cellPx);
        }
      }
    };

    let raf = 0, lastT = 0;
    const loop = (t: number) => {
      if (t - lastT > 40) { frame(t); lastT = t; } // 25 fps
      raf = requestAnimationFrame(loop);
    };
    const ro = new ResizeObserver(() => { sample(); frame(performance.now()); });
    img.addEventListener(
      "load",
      () => {
        sample();
        ro.observe(canvas);
        if (reduce) frame(6000);
        else raf = requestAnimationFrame(loop);
      },
      { once: true },
    );
    img.src = src;
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [src, cell, opacity]);
  return <canvas ref={ref} aria-hidden className={className} />;
}
