"use client";

import type { GraphEdge, GraphNode, NamespaceGraph } from "@marrow/core";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceX, forceY, type Simulation } from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { ArrowUpRight, Download, Minus, MoreHorizontal, Pin, PinOff, Plus, Scan, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { kindLabel } from "@/lib/kind";
import { fmtDate, fmtTs } from "@/lib/time";

// Knowledge graph of a namespace: item nodes (squares) and entity nodes (circles, coloured by kind, sized by
// mentions) joined by mention edges. Three layouts (force / radial by kind / bipartite columns), filters (kind,
// min mentions, contested, publish date), pinning, insights, a claims-level detail panel, SVG + markdown export.

// Legend order = the validated categorical slot order (see globals.css), so adjacent hues stay distinguishable.
const KIND_ORDER = ["paper", "tool", "technique", "dataset", "person", "repo", "other"] as const;
const kindColor = (kind: string) => `var(--kind-${(KIND_ORDER as readonly string[]).includes(kind) ? kind : "other"})`;

type SimNode = GraphNode & { x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null; r: number };
type SimLink = { source: SimNode; target: SimNode; edge: GraphEdge };
type Layout = "force" | "radial" | "columns";
const LAYOUTS: Array<{ id: Layout; label: string; hint: string }> = [
  { id: "force", label: "Force", hint: "Physics layout — clusters show what is discussed together" },
  { id: "radial", label: "Radial", hint: "Items in the middle, entities on a ring grouped by kind" },
  { id: "columns", label: "Columns", hint: "Items left, entities right — read the overlap across items" },
];

export function KnowledgeGraph({ data, focus }: { data: NamespaceGraph; focus?: string | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [, bump] = useState(0);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<{ id: string; x: number; y: number } | null>(null);
  const [query, setQuery] = useState("");
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [layout, setLayout] = useState<Layout>("force");
  const [minMentions, setMinMentions] = useState(1);
  const [contestedOnly, setContestedOnly] = useState(false);
  const [labels, setLabels] = useState<"auto" | "all" | "none">("auto");
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  const zoomRef = useRef<ReturnType<typeof zoom<SVGSVGElement, unknown>> | null>(null);

  // ---- time scrub: items in publish order; the slider shows the corpus "as of" the Nth item ----
  const timeline = useMemo(
    () =>
      data.nodes
        .filter((n): n is Extract<GraphNode, { type: "item" }> => n.type === "item")
        .sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? "")),
    [data],
  );
  const [through, setThrough] = useState(timeline.length);
  useEffect(() => setThrough(timeline.length), [timeline.length]);
  const maxMentions = useMemo(() => Math.max(1, ...data.nodes.map((n) => (n.type === "entity" ? n.mentions : 0))), [data]);

  // ---- layout ----
  useEffect(() => {
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = rect?.width ? rect.width / 2 : 400;
    const cy = rect?.height ? rect.height / 2 : 300;
    const ns: SimNode[] = data.nodes.map((n, i) => ({
      ...n,
      x: cx + Math.cos(i) * 200,
      y: cy + Math.sin(i) * 200,
      r: n.type === "item" ? 9 : 4 + Math.sqrt(n.mentions / maxMentions) * 10,
    }));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const ls: SimLink[] = data.edges.flatMap((e) => {
      const s = byId.get(e.source);
      const t = byId.get(e.target);
      return s && t ? [{ source: s, target: t, edge: e }] : [];
    });
    const smallGraph = ns.length <= 60;
    const labelPad = (d: SimNode) => (d.type === "item" ? Math.min(140, d.label.length * 3.2) : smallGraph || d.degree >= 2 ? Math.min(110, d.label.length * 2.6) : 0);

    let sim: Simulation<SimNode, undefined>;
    if (layout === "columns") {
      // Bipartite: items on the left ordered by degree, entities on the right ordered by the barycentre of their items.
      const items = ns.filter((n) => n.type === "item").sort((a, b) => b.degree - a.degree);
      const gap = 30;
      const itemY = new Map<string, number>();
      items.forEach((n, i) => {
        n.fx = cx - 260;
        n.fy = cy + (i - (items.length - 1) / 2) * gap;
        n.x = n.fx;
        n.y = n.fy;
        itemY.set(n.id, n.fy);
      });
      const ents = ns.filter((n) => n.type === "entity");
      const bary = new Map<string, number>();
      for (const e of ents) {
        const ys = ls.filter((l) => l.source.id === e.id).map((l) => itemY.get(l.target.id) ?? cy);
        bary.set(e.id, ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : cy);
      }
      ents.sort((a, b) => bary.get(a.id)! - bary.get(b.id)! || b.degree - a.degree);
      const egap = Math.max(18, Math.min(30, (items.length * gap * 1.6) / Math.max(1, ents.length)));
      ents.forEach((n, i) => {
        n.fx = cx + 260;
        n.fy = cy + (i - (ents.length - 1) / 2) * egap;
        n.x = n.fx;
        n.y = n.fy;
      });
      sim = forceSimulation(ns).stop();
    } else if (layout === "radial") {
      // Items on an inner ring, entities on an outer ring in kind sectors (legend order), so kinds read as arcs.
      const items = ns.filter((n) => n.type === "item");
      const ents = ns.filter((n) => n.type === "entity");
      // Ring radii scale with counts so item labels on the inner ring don't collide.
      const inner = Math.max(90, items.length * 17);
      const outer = inner + 200 + Math.sqrt(ents.length) * 26;
      const order = [...KIND_ORDER];
      const sorted = [...ents].sort((a, b) => order.indexOf((a.type === "entity" ? a.kind : "other") as never) - order.indexOf((b.type === "entity" ? b.kind : "other") as never) || b.mentions - a.mentions);
      const angle = new Map<string, number>();
      sorted.forEach((n, i) => angle.set(n.id, (i / Math.max(1, sorted.length)) * Math.PI * 2 - Math.PI / 2));
      items.forEach((n, i) => angle.set(n.id, (i / Math.max(1, items.length)) * Math.PI * 2 - Math.PI / 2));
      for (const n of ns) {
        const a = angle.get(n.id) ?? 0;
        const rr = n.type === "item" ? inner : outer;
        n.x = cx + Math.cos(a) * rr;
        n.y = cy + Math.sin(a) * rr;
      }
      sim = forceSimulation(ns)
        .force("radial", forceRadial<SimNode>((d) => (d.type === "item" ? inner : outer), cx, cy).strength(1))
        .force("x", forceX<SimNode>((d) => cx + Math.cos(angle.get(d.id) ?? 0) * (d.type === "item" ? inner : outer)).strength(0.2))
        .force("y", forceY<SimNode>((d) => cy + Math.sin(angle.get(d.id) ?? 0) * (d.type === "item" ? inner : outer)).strength(0.2))
        .force("collide", forceCollide<SimNode>().radius((d) => d.r + 6).iterations(2))
        .stop();
      for (let i = 0; i < 200; i++) sim.tick();
    } else {
      sim = forceSimulation(ns)
        .force("link", forceLink<SimNode, SimLink>(ls).id((d) => d.id).distance((l) => 110 + 60 / Math.sqrt(l.edge.weight)).strength(0.5))
        .force("charge", forceManyBody().strength((d) => ((d as SimNode).type === "item" ? -420 : -220)))
        .force("center", forceCenter(cx, cy))
        .force("collide", forceCollide<SimNode>().radius((d) => d.r + 14 + labelPad(d)).iterations(2))
        .stop();
      for (let i = 0; i < 400; i++) sim.tick();
    }
    sim.on("tick", () => bump((v) => v + 1));
    simRef.current = sim;
    setNodes(ns);
    setLinks(ls);
    setPinned(new Set());
    return () => {
      sim.stop();
    };
  }, [data, layout, maxMentions]);

  // ---- zoom / pan ----
  useEffect(() => {
    if (!svgRef.current) return;
    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 5])
      .filter((e: Event) => !(e.target as Element).closest("[data-node]"))
      .on("zoom", (e: { transform: ZoomTransform }) => setTransform(e.transform));
    select(svgRef.current).call(z);
    zoomRef.current = z;
  }, []);

  const fit = useCallback((animate = true) => {
    const svg = svgRef.current;
    if (!svg || !nodes.length || !zoomRef.current) return;
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const [x0, x1, y0, y1] = [Math.min(...xs) - 60, Math.max(...xs) + 120, Math.min(...ys) - 30, Math.max(...ys) + 30];
    const { width, height } = svg.getBoundingClientRect();
    if (!width || !height) return;
    const top = 56;
    const bottom = 64;
    const usable = Math.max(120, height - top - bottom);
    // Small graphs may scale up (to 1.5×) so they fill the canvas; large ones scale down to fit.
    const k = Math.min(1.5, 0.92 / Math.max((x1 - x0) / width, (y1 - y0) / usable));
    const t = zoomIdentity.translate(width / 2 - (k * (x0 + x1)) / 2, top + usable / 2 - (k * (y0 + y1)) / 2).scale(k);
    const sel = select(svg);
    if (animate) sel.transition().duration(300).call(zoomRef.current.transform, t);
    else sel.call(zoomRef.current.transform, t);
  }, [nodes]);
  useEffect(() => {
    let tries = 0;
    let raf = 0;
    const attempt = () => {
      const w = svgRef.current?.getBoundingClientRect().width ?? 0;
      if (w > 0 || tries > 20) fit(false);
      else {
        tries++;
        raf = requestAnimationFrame(attempt);
      }
    };
    attempt();
    return () => cancelAnimationFrame(raf);
  }, [fit]);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    let last = 0;
    const ro = new ResizeObserver(() => {
      const w = svg.getBoundingClientRect().width;
      if (Math.abs(w - last) > 4) {
        last = w;
        fit(false);
      }
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, [fit]);
  const zoomBy = (f: number) => svgRef.current && zoomRef.current && select(svgRef.current).transition().duration(150).call(zoomRef.current.scaleBy, f);
  const centerOn = useCallback(
    (id: string) => {
      const n = nodes.find((x) => x.id === id);
      const svg = svgRef.current;
      if (!n || !svg || !zoomRef.current) return;
      const { width, height } = svg.getBoundingClientRect();
      const k = Math.max(transform.k, 1);
      select(svg).transition().duration(300).call(zoomRef.current.transform, zoomIdentity.translate(width / 2 - k * n.x, height / 2 - k * n.y).scale(k));
    },
    [nodes, transform.k],
  );

  // ---- keyboard: "/" search, Esc clear, f fit ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape") {
        if (typing) (t as HTMLElement).blur();
        setSelected(null);
        setQuery("");
      } else if (!typing && e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (!typing && e.key.toLowerCase() === "f") fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fit]);

  // ---- drag (drag pins the node; double-click releases it) ----
  const dragging = useRef<{ n: SimNode; moved: boolean } | null>(null);
  const toGraph = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return transform.invert([e.clientX - rect.left, e.clientY - rect.top]);
  };
  const onNodeDown = (n: SimNode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragging.current = { n, moved: false };
    n.fx = n.x;
    n.fy = n.y;
    if (layout === "force") simRef.current?.alphaTarget(0.25).restart();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragging.current;
    if (!d) return;
    const [x, y] = toGraph(e);
    d.n.fx = x;
    d.n.fy = y;
    d.n.x = x;
    d.n.y = y;
    d.moved = true;
    if (layout !== "force") bump((v) => v + 1);
  };
  const onUp = () => {
    const d = dragging.current;
    if (!d) return;
    if (d.moved && layout === "force") setPinned((p) => new Set(p).add(d.n.id));
    else if (!pinned.has(d.n.id) && layout === "force") {
      d.n.fx = null;
      d.n.fy = null;
    }
    dragging.current = null;
    simRef.current?.alphaTarget(0);
  };
  const unpin = (id?: string) => {
    for (const n of nodes) {
      if (id && n.id !== id) continue;
      if (layout === "force") {
        n.fx = null;
        n.fy = null;
      }
    }
    setPinned((p) => {
      if (!id) return new Set();
      const s = new Set(p);
      s.delete(id);
      return s;
    });
    if (layout === "force") simRef.current?.alpha(0.3).restart();
  };

  // ---- filtering / emphasis ----
  const q = query.trim().toLowerCase();
  const asOf = useMemo(() => new Set(timeline.slice(0, through).map((n) => n.id)), [timeline, through]);
  const visible = useMemo(() => {
    const ok = new Set<string>();
    const itemsOk = new Set<string>();
    for (const n of nodes) if (n.type === "item" && asOf.has(n.id)) itemsOk.add(n.id);
    const entityHasItem = new Map<string, boolean>();
    for (const l of links) if (itemsOk.has(l.target.id)) entityHasItem.set(l.source.id, true);
    for (const n of nodes) {
      if (n.type === "item") {
        if (itemsOk.has(n.id)) ok.add(n.id);
        continue;
      }
      if (hiddenKinds.has(n.kind) || n.mentions < minMentions || (contestedOnly && !n.contested)) continue;
      if (through < timeline.length && !entityHasItem.get(n.id)) continue;
      ok.add(n.id);
    }
    return ok;
  }, [nodes, links, hiddenKinds, minMentions, contestedOnly, asOf, through, timeline.length]);
  const matches = (n: SimNode) => !q || n.label.toLowerCase().includes(q) || (n.type === "entity" && n.aliases.some((a) => a.toLowerCase().includes(q)));
  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of links) {
      (m.get(l.source.id) ?? m.set(l.source.id, new Set()).get(l.source.id)!).add(l.target.id);
      (m.get(l.target.id) ?? m.set(l.target.id, new Set()).get(l.target.id)!).add(l.source.id);
    }
    return m;
  }, [links]);
  const emphasis = selected ?? hover;
  const isDim = (id: string) => (emphasis ? id !== emphasis && !neighbours.get(emphasis)?.has(id) : false);
  const selectedNode = nodes.find((n) => n.id === selected) ?? null;
  const hoverNode = tip ? nodes.find((n) => n.id === tip.id) ?? null : null;
  const kindCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of data.nodes) if (n.type === "entity") c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [data]);
  const showLabel = (n: SimNode) =>
    labels === "all" ||
    (labels === "auto" && (n.type === "item" || transform.k >= 1.4 || nodes.length <= 60 || n.degree >= 2 || n.id === emphasis || (emphasis ? neighbours.get(emphasis)?.has(n.id) : false) || (q && matches(n))));
  const shown = [...visible].length;
  const select_ = (id: string | null) => {
    setSelected(id);
    if (id) centerOn(id);
  };

  // ---- export ----
  const downloadSvg = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const { width, height } = svg.getBoundingClientRect();
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(Math.round(width)));
    clone.setAttribute("height", String(Math.round(height)));
    clone.setAttribute("viewBox", `0 0 ${Math.round(width)} ${Math.round(height)}`);
    const css = getComputedStyle(document.documentElement);
    const resolve = (v: string) => v.replace(/var\((--[\w-]+)\)/g, (_, name: string) => css.getPropertyValue(name).trim() || "#888");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", css.getPropertyValue("--card").trim() || "#151515");
    clone.insertBefore(bg, clone.firstChild);
    for (const el of clone.querySelectorAll<SVGElement>("*")) {
      for (const attr of ["fill", "stroke", "font-family"]) {
        const v = el.getAttribute(attr);
        if (v?.includes("var(")) el.setAttribute(attr, resolve(v).replace("--font-serif", "Source Serif 4, serif").replace("--font-sans", "IBM Plex Sans, sans-serif"));
      }
      el.removeAttribute("class");
      el.removeAttribute("tabindex");
    }
    const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${data.namespace.name}-graph.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copyMarkdown = async () => {
    const ents = data.nodes.filter((n): n is Extract<GraphNode, { type: "entity" }> => n.type === "entity" && visible.has(n.id));
    const lines = [`# ${data.namespace.name} — entities`, ""];
    for (const k of KIND_ORDER) {
      const rows = ents.filter((e) => e.kind === k).sort((a, b) => b.mentions - a.mentions);
      if (!rows.length) continue;
      lines.push(`## ${kindLabel(k)}`, "", ...rows.map((e) => `- ${e.url ? `[${e.label}](${e.url})` : e.label} — ${e.mentions} mention${e.mentions === 1 ? "" : "s"} in ${e.degree} item${e.degree === 1 ? "" : "s"}${e.contested ? " · contested" : ""}`), "");
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Copied", { description: `${ents.length} entities as markdown.` });
    } catch {
      toast.error("Couldn't copy", { description: "Your browser blocked clipboard access." });
    }
  };

  return (
    <div ref={wrapRef} className="space-y-3">
      {/* Control strip: layout, filters, count. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] text-muted-foreground">
        <div className="inline-flex rounded-md border border-border/70 p-0.5" role="tablist" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button key={l.id} type="button" role="tab" aria-selected={layout === l.id} title={l.hint} onClick={() => setLayout(l.id)} className={`cursor-pointer rounded-[5px] px-2.5 py-1 uppercase tracking-wide transition-colors ${layout === l.id ? "bg-muted text-foreground" : "hover:text-foreground"}`}>
              {l.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2">
          <span>min mentions</span>
          <Slider value={[minMentions]} min={1} max={Math.max(2, maxMentions)} step={1} onValueChange={(v) => setMinMentions(Array.isArray(v) ? (v[0] ?? 1) : (v as number))} className="w-24" aria-label="Minimum mentions" />
          <span className="w-4 text-foreground">{minMentions}</span>
        </label>
        {timeline.length > 1 && (
          <label className="flex items-center gap-2">
            <span>through</span>
            <Slider value={[through]} min={1} max={timeline.length} step={1} onValueChange={(v) => setThrough(Array.isArray(v) ? (v[0] ?? 1) : (v as number))} className="w-28" aria-label="Show items published through" />
            <span className="text-foreground">{timeline[through - 1]?.published_at ? fmtDate(timeline[through - 1]!.published_at!) : `${through}/${timeline.length}`}</span>
          </label>
        )}
        <button type="button" aria-pressed={contestedOnly} onClick={() => setContestedOnly((v) => !v)} className={`cursor-pointer rounded-md border px-2 py-0.5 uppercase tracking-wide transition-colors ${contestedOnly ? "border-time/60 text-time" : "border-border/70 hover:text-foreground"}`}>
          contested only
        </button>
        <span className="ml-auto">
          {shown} of {data.nodes.length} nodes
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="relative h-[60vh] min-h-[420px] overflow-hidden rounded-lg border border-border/70 bg-card lg:h-[calc(100vh-14.5rem)]">
          <svg ref={svgRef} className="size-full touch-none select-none" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onClick={() => setSelected(null)}>
            <defs>
              <pattern id="kg-hatch" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="4" stroke="var(--muted-foreground)" strokeWidth="1.5" />
              </pattern>
            </defs>
            <g transform={transform.toString()}>
              {links.map((l) => {
                if (!visible.has(l.source.id) || !visible.has(l.target.id)) return null;
                const lit = emphasis && (l.source.id === emphasis || l.target.id === emphasis);
                const contested = l.edge.stances.opposes > 0;
                return (
                  <line
                    key={l.edge.id}
                    x1={l.source.x}
                    y1={l.source.y}
                    x2={l.target.x}
                    y2={l.target.y}
                    stroke={lit ? "var(--time)" : "var(--muted-foreground)"}
                    strokeWidth={lit ? 1.5 + Math.min(2, l.edge.weight * 0.3) : 1 + Math.min(1.5, l.edge.weight * 0.2)}
                    strokeDasharray={contested ? "4 3" : undefined}
                    opacity={emphasis && !lit ? 0.12 : 0.45}
                  />
                );
              })}
              {nodes.map((n) => {
                if (!visible.has(n.id)) return null;
                const dim = isDim(n.id) || (q ? !matches(n) : false);
                const sel = n.id === selected;
                const isPinned = pinned.has(n.id);
                return (
                  <g
                    key={n.id}
                    data-node
                    transform={`translate(${n.x},${n.y})`}
                    opacity={dim ? 0.2 : 1}
                    className="cursor-grab outline-none active:cursor-grabbing"
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.type === "item" ? kindLabel(n.source_type) : n.kind}: ${n.label}`}
                    aria-pressed={sel}
                    onFocus={() => setHover(n.id)}
                    onBlur={() => setHover((h) => (h === n.id ? null : h))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected((s) => (s === n.id ? null : n.id));
                      }
                    }}
                    onPointerDown={onNodeDown(n)}
                    onPointerEnter={(e) => {
                      setHover(n.id);
                      const rect = wrapRef.current?.getBoundingClientRect();
                      setTip({ id: n.id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
                    }}
                    onPointerMove={(e) => {
                      if (dragging.current) return;
                      const rect = wrapRef.current?.getBoundingClientRect();
                      setTip((t) => (t?.id === n.id ? { id: n.id, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) } : t));
                    }}
                    onPointerLeave={() => {
                      setHover((h) => (h === n.id ? null : h));
                      setTip((t) => (t?.id === n.id ? null : t));
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (isPinned) unpin(n.id);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (dragging.current?.moved) return;
                      setSelected((s) => (s === n.id ? null : n.id));
                    }}
                  >
                    {n.type === "item" ? (
                      <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={n.source_type === "youtube_video" || n.source_type === "podcast_episode" ? 3 : n.r} fill="var(--foreground)" stroke={sel ? "var(--time)" : "var(--card)"} strokeWidth={sel ? 2.5 : 2} />
                    ) : (
                      <circle r={n.r} fill={n.contested ? "url(#kg-hatch)" : kindColor(n.kind)} stroke={sel ? "var(--time)" : n.contested ? kindColor(n.kind) : "var(--card)"} strokeWidth={sel ? 2.5 : 2} />
                    )}
                    {isPinned && <circle r={n.r + 4} fill="none" stroke="var(--time)" strokeWidth={1} strokeDasharray="2 2" />}
                    {showLabel(n) && (
                      <text
                        x={n.r + 5}
                        y={4}
                        fontSize={n.type === "item" ? 11.5 : 11}
                        fontFamily={n.type === "item" ? "var(--font-serif)" : "var(--font-sans)"}
                        fontWeight={n.type === "item" ? 600 : sel ? 600 : 400}
                        fill={n.type === "item" ? "var(--foreground)" : "var(--muted-foreground)"}
                        paintOrder="stroke"
                        stroke="var(--card)"
                        strokeWidth={3}
                        strokeLinejoin="round"
                      >
                        {n.label.length > 36 ? `${n.label.slice(0, 34)}…` : n.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Hover tooltip (selection lives in the panel). */}
          {hoverNode && tip && hoverNode.id !== selected && !dragging.current && (
            <div className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-border/70 bg-popover/95 px-2.5 py-2 text-[12px] shadow-md backdrop-blur" style={{ left: tip.x + 14, top: tip.y + 14 }}>
              <p className="reading truncate font-medium text-foreground">{hoverNode.label}</p>
              <p className="font-mono text-[11px] text-muted-foreground">
                {hoverNode.type === "item"
                  ? `${kindLabel(hoverNode.source_type)} · ${hoverNode.degree} entit${hoverNode.degree === 1 ? "y" : "ies"}${hoverNode.channel ? ` · ${hoverNode.channel}` : ""}`
                  : `${hoverNode.kind} · ${hoverNode.mentions} mention${hoverNode.mentions === 1 ? "" : "s"} in ${hoverNode.degree} item${hoverNode.degree === 1 ? "" : "s"}${hoverNode.contested ? " · contested" : ""}`}
              </p>
            </div>
          )}

          <div className="absolute left-3 top-3 flex items-center gap-2">
            <Input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node…  /" className="h-7 w-52 text-[13px]" aria-label="Find a node" />
            {query && (
              <Button variant="outline" size="icon-sm" aria-label="Clear search" onClick={() => setQuery("")}>
                <X />
              </Button>
            )}
          </div>
          <div className="absolute right-3 top-3 flex items-center gap-1.5">
            <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>
              <Plus />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
              <Minus />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Fit to view (f)" onClick={() => fit()}>
              <Scan />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More" />}>
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="font-sans text-[13px]">
                <DropdownMenuItem onClick={() => setLabels((l) => (l === "all" ? "auto" : "all"))}>{labels === "all" ? "Labels: automatic" : "Labels: show all"}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setLabels((l) => (l === "none" ? "auto" : "none"))}>{labels === "none" ? "Labels: automatic" : "Labels: hide"}</DropdownMenuItem>
                <DropdownMenuItem disabled={pinned.size === 0} onClick={() => unpin()}>
                  <PinOff />
                  Release {pinned.size ? `${pinned.size} pinned` : "pins"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={downloadSvg}>
                  <Download />
                  Download SVG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void copyMarkdown()}>Copy entity list (markdown)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/70 bg-card/90 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-[2px] bg-foreground" /> video
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full bg-foreground" /> text
            </span>
            {KIND_ORDER.filter((k) => kindCounts.has(k)).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setHiddenKinds((h) => {
                    const n = new Set(h);
                    if (n.has(k)) n.delete(k);
                    else n.add(k);
                    return n;
                  })
                }
                className={`inline-flex cursor-pointer items-center gap-1.5 transition-opacity ${hiddenKinds.has(k) ? "opacity-35 line-through" : ""}`}
                aria-pressed={!hiddenKinds.has(k)}
              >
                <span className="inline-block size-2.5 rounded-full" style={{ background: kindColor(k) }} /> {k} <span className="text-muted-foreground/90">{kindCounts.get(k)}</span>
              </button>
            ))}
            <span>· hatched = contested · dashed edge = opposed · drag pins</span>
          </div>
        </div>

        <aside className="min-w-0 space-y-4 lg:h-[calc(100vh-14.5rem)] lg:overflow-y-auto lg:pr-1">
          {selectedNode ? (
            <NodePanel node={selectedNode} links={links} namespace={data.namespace.name} onSelect={select_} pinned={pinned.has(selectedNode.id)} onUnpin={() => unpin(selectedNode.id)} />
          ) : (
            <Insights data={data} visible={visible} onSelect={select_} />
          )}
        </aside>
      </div>
    </div>
  );
}

/** What to look at when nothing is selected: hubs, disagreements, the long tail, and the kind mix. */
function Insights({ data, visible, onSelect }: { data: NamespaceGraph; visible: Set<string>; onSelect: (id: string) => void }) {
  const ents = data.nodes.filter((n): n is Extract<GraphNode, { type: "entity" }> => n.type === "entity" && visible.has(n.id));
  const hubs = [...ents].sort((a, b) => b.degree - a.degree || b.mentions - a.mentions).slice(0, 6);
  const contested = ents.filter((e) => e.contested).sort((a, b) => b.stances.opposes + b.stances.supports - (a.stances.opposes + a.stances.supports)).slice(0, 6);
  const singletons = ents.filter((e) => e.degree === 1).length;
  const items = data.nodes.filter((n): n is Extract<GraphNode, { type: "item" }> => n.type === "item" && visible.has(n.id));
  const loneItems = items.filter((i) => i.degree === 0);
  const kinds = KIND_ORDER.map((k) => ({ k, n: ents.filter((e) => e.kind === k).length })).filter((x) => x.n > 0);
  const total = Math.max(1, ents.length);
  const Row = ({ e, meta }: { e: Extract<GraphNode, { type: "entity" }>; meta: string }) => (
    <li>
      <button type="button" onClick={() => onSelect(e.id)} className="flex w-full cursor-pointer items-center gap-2.5 py-1.5 text-left hover:text-foreground">
        <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: kindColor(e.kind) }} />
        <span className="min-w-0 flex-1 truncate text-[14px]">{e.label}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{meta}</span>
      </button>
    </li>
  );
  return (
    <div className="space-y-6 text-sm text-muted-foreground">
      <div className="space-y-2">
        <p className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.14em]">
          <Sparkles className="size-3" /> Hubs
        </p>
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {hubs.map((e) => (
            <Row key={e.id} e={e} meta={`${e.degree} item${e.degree === 1 ? "" : "s"}`} />
          ))}
          {hubs.length === 0 && <li className="py-2">Nothing to show with these filters.</li>}
        </ul>
        <p className="text-[12px]">Entities mentioned across the most items — the corpus's recurring threads.</p>
      </div>
      {contested.length > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-time">Contested</p>
          <ul className="divide-y divide-border/70 border-y border-border/70">
            {contested.map((e) => (
              <Row key={e.id} e={e} meta={`${e.stances.supports}↑ ${e.stances.opposes}↓`} />
            ))}
          </ul>
          <p className="text-[12px]">Supported in some items, opposed in others (PRD §9). Open one to read the claims side by side.</p>
        </div>
      )}
      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em]">Kinds</p>
        <ul className="space-y-1">
          {kinds.map(({ k, n }) => (
            <li key={k} className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-16 shrink-0">{k}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full" style={{ width: `${(n / total) * 100}%`, background: kindColor(k) }} />
              </span>
              <span className="w-6 text-right text-foreground">{n}</span>
            </li>
          ))}
        </ul>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
        <dt>long tail</dt>
        <dd className="text-foreground">
          {singletons} entit{singletons === 1 ? "y" : "ies"} in one item only
        </dd>
        {loneItems.length > 0 && (
          <>
            <dt>unlinked</dt>
            <dd className="text-foreground">
              {loneItems.length} item{loneItems.length === 1 ? "" : "s"} without entities
            </dd>
          </>
        )}
      </dl>
      <p className="reading text-[14px] leading-relaxed">Click a node for its claims and connections; drag to pin; press / to search, f to fit, Esc to clear.</p>
    </div>
  );
}

function StanceBar({ s }: { s: { supports: number; opposes: number; neutral: number } }) {
  const total = s.supports + s.opposes + s.neutral;
  if (!total) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="space-y-1">
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${s.supports} supporting, ${s.opposes} opposing, ${s.neutral} neutral`}>
        <span className="h-full bg-foreground" style={{ width: pct(s.supports) }} />
        <span className="h-full bg-muted-foreground/40" style={{ width: pct(s.neutral) }} />
        <span className="h-full bg-time" style={{ width: pct(s.opposes) }} />
      </div>
      <p className="font-mono text-[11px] text-muted-foreground">
        {s.supports} supporting · {s.neutral} neutral · <span className={s.opposes ? "text-time" : ""}>{s.opposes} opposing</span>
      </p>
    </div>
  );
}

function NodePanel({ node, links, namespace, onSelect, pinned, onUnpin }: { node: SimNode; links: SimLink[]; namespace: string; onSelect: (id: string) => void; pinned: boolean; onUnpin: () => void }) {
  const mine = links.filter((l) => l.source.id === node.id || l.target.id === node.id).sort((a, b) => b.edge.weight - a.edge.weight);
  // Co-mentioned entities: share at least one item with this entity (or, for an item, entities it shares with other items).
  const related = useMemo(() => {
    const counts = new Map<string, { n: SimNode; shared: number }>();
    if (node.type === "entity") {
      const myItems = new Set(mine.map((l) => l.target.id));
      for (const l of links) {
        if (l.source.id === node.id || !myItems.has(l.target.id)) continue;
        const cur = counts.get(l.source.id) ?? { n: l.source, shared: 0 };
        cur.shared++;
        counts.set(l.source.id, cur);
      }
    } else {
      const myEnts = new Set(mine.map((l) => l.source.id));
      for (const l of links) {
        if (l.target.id === node.id || !myEnts.has(l.source.id)) continue;
        const cur = counts.get(l.target.id) ?? { n: l.target, shared: 0 };
        cur.shared++;
        counts.set(l.target.id, cur);
      }
    }
    return [...counts.values()].sort((a, b) => b.shared - a.shared).slice(0, 8);
  }, [node, links, mine]);
  const ask = node.type === "entity" ? `What does this corpus say about ${node.label}? Where do the items disagree?` : `Summarise "${node.label}" and how it relates to the rest of the corpus.`;

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {node.type === "item" ? <span className="inline-block size-2.5 rounded-[2px] bg-foreground" /> : <span className="inline-block size-2.5 rounded-full" style={{ background: kindColor(node.kind) }} />}
          {node.type === "item" ? kindLabel(node.source_type) : node.kind}
          {node.type === "entity" && node.contested && <span className="text-time">· contested</span>}
          {pinned && (
            <button type="button" onClick={onUnpin} className="inline-flex cursor-pointer items-center gap-1 text-time hover:underline" title="Release this node">
              <Pin className="size-3" /> pinned
            </button>
          )}
        </p>
        <h2 className="reading text-[20px] font-semibold leading-snug tracking-tight">{node.label}</h2>
        {node.type === "item" ? (
          <p className="font-mono text-xs text-muted-foreground">
            {[node.channel, node.published_at ? fmtDate(node.published_at) : null, node.duration_s ? fmtTs(node.duration_s) : null].filter(Boolean).join(" · ")}
          </p>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">
            {node.degree} item{node.degree === 1 ? "" : "s"} · {node.mentions} mention{node.mentions === 1 ? "" : "s"}
            {node.aliases.length ? ` · aka ${node.aliases.slice(0, 3).join(", ")}` : ""}
          </p>
        )}
        {node.type === "entity" && <StanceBar s={node.stances} />}
        <div className="flex flex-wrap gap-2 pt-1">
          {node.type === "item" && (
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/items/${node.id}`} />}>
              Open
              <ArrowUpRight />
            </Button>
          )}
          {node.type === "entity" && node.url && (
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={node.url} target="_blank" rel="noreferrer" />}>
              Source
              <ArrowUpRight />
            </Button>
          )}
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/namespaces/${encodeURIComponent(namespace)}/chat?q=${encodeURIComponent(ask)}`} />}>
            <Sparkles />
            Ask the corpus
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{node.type === "item" ? "Mentions" : "Appears in"}</p>
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {mine.map((l) => {
            const other = l.source.id === node.id ? l.target : l.source;
            const s = l.edge.stances;
            const stance = s.opposes && s.supports ? "contested" : s.opposes ? "opposes" : s.supports ? "supports" : null;
            const item = other.type === "item" ? other : node.type === "item" ? node : null;
            const timed = item && item.type === "item" && (item.source_type === "youtube_video" || item.source_type === "podcast_episode" || item.source_type === "uploaded_media");
            const href = other.type === "item" ? `/items/${other.id}${l.edge.t_first !== null && timed ? `?t=${Math.floor(l.edge.t_first)}` : ""}` : null;
            return (
              <li key={l.edge.id} className="space-y-1.5 py-2.5">
                <div className="flex items-start gap-3">
                  <button type="button" onClick={() => onSelect(other.id)} className="mt-1.5 shrink-0 cursor-pointer" aria-label={`Select ${other.label}`}>
                    {other.type === "item" ? <span className="block size-2.5 rounded-[2px] bg-foreground" /> : <span className="block size-2.5 rounded-full" style={{ background: kindColor(other.kind) }} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    {href ? (
                      <Link href={href} className="reading block truncate text-[15px] hover:underline">
                        {other.label}
                      </Link>
                    ) : (
                      <button type="button" onClick={() => onSelect(other.id)} className="block max-w-full cursor-pointer truncate text-left text-[14px] hover:underline">
                        {other.label}
                      </button>
                    )}
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {l.edge.weight} mention{l.edge.weight === 1 ? "" : "s"}
                      {stance ? ` · ${stance}` : ""}
                      {l.edge.t_first !== null && timed ? ` · first at ${fmtTs(l.edge.t_first)}` : ""}
                    </p>
                  </div>
                </div>
                {l.edge.claims.length > 0 && (
                  <ul className="ml-[22px] space-y-1 border-l border-border/70 pl-3">
                    {l.edge.claims.map((c, i) => (
                      <li key={i} className="reading text-[13.5px] leading-snug text-foreground/85">
                        <span className={`mr-1.5 font-mono text-[10px] ${c.stance === "opposes" ? "text-time" : "text-muted-foreground"}`}>{c.stance === "supports" ? "↑" : c.stance === "opposes" ? "↓" : "·"}</span>
                        {c.text}
                        {c.t !== null && item && timed && (
                          <Link href={`/items/${item.id}?t=${Math.floor(c.t)}`} className="timecode ml-1.5 align-[1px] text-[10px]">
                            {fmtTs(c.t)}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          {mine.length === 0 && <li className="py-2 text-sm text-muted-foreground">No connections yet.</li>}
        </ul>
      </div>

      {related.length > 0 && (
        <div className="space-y-1.5">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{node.type === "entity" ? "Discussed alongside" : "Overlaps with"}</p>
          <ul className="divide-y divide-border/70 border-y border-border/70">
            {related.map(({ n, shared }) => (
              <li key={n.id}>
                <button type="button" onClick={() => onSelect(n.id)} className="flex w-full cursor-pointer items-center gap-2.5 py-1.5 text-left hover:text-foreground">
                  {n.type === "item" ? <span className="inline-block size-2.5 shrink-0 rounded-[2px] bg-foreground" /> : <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ background: kindColor(n.kind) }} />}
                  <span className="min-w-0 flex-1 truncate text-[14px]">{n.label}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {shared} shared {node.type === "entity" ? "item" : "entit"}
                    {shared === 1 ? (node.type === "entity" ? "" : "y") : node.type === "entity" ? "s" : "ies"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
