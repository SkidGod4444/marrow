"use client";

import type { GraphEdge, GraphNode, NamespaceGraph } from "@marrow/core";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, type Simulation } from "d3-force";
import { select } from "d3-selection";
import { zoom, zoomIdentity, type ZoomTransform } from "d3-zoom";
import { ArrowUpRight, Minus, Plus, Scan, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtTs } from "@/lib/time";

// Knowledge graph of a namespace: item nodes (videos, squares) and entity nodes (circles, coloured by kind,
// sized by mentions) joined by mention edges. Layout: d3-force, run to rest once, then still; drag re-heats it.

// Legend order = the validated categorical slot order (see globals.css), so adjacent hues stay distinguishable.
const KIND_ORDER = ["paper", "tool", "technique", "dataset", "person", "repo", "other"] as const;
const kindColor = (kind: string) => `var(--kind-${(KIND_ORDER as readonly string[]).includes(kind) ? kind : "other"})`;

type SimNode = GraphNode & { x: number; y: number; vx?: number; vy?: number; fx?: number | null; fy?: number | null; r: number };
type SimLink = { source: SimNode; target: SimNode; edge: GraphEdge };

export function KnowledgeGraph({ data, focus }: { data: NamespaceGraph; focus?: string | null }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const [nodes, setNodes] = useState<SimNode[]>([]);
  const [links, setLinks] = useState<SimLink[]>([]);
  const [, bump] = useState(0);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const [selected, setSelected] = useState<string | null>(focus ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const zoomRef = useRef<ReturnType<typeof zoom<SVGSVGElement, unknown>> | null>(null);

  // ---- layout ----
  useEffect(() => {
    // Centre the layout on the canvas itself, so the graph is visible even before (or without) a fit-to-view.
    const rect = svgRef.current?.getBoundingClientRect();
    const cx = rect?.width ? rect.width / 2 : 400;
    const cy = rect?.height ? rect.height / 2 : 300;
    const maxMentions = Math.max(1, ...data.nodes.map((n) => (n.type === "entity" ? n.mentions : 0)));
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
    // Labels take horizontal room to the right of a node; reserve it in the collision radius so labels don't cover neighbours.
    const smallGraph = ns.length <= 60;
    const labelPad = (d: SimNode) => (d.type === "item" ? Math.min(140, d.label.length * 3.2) : smallGraph || d.degree >= 2 ? Math.min(110, d.label.length * 2.6) : 0);
    const sim = forceSimulation(ns)
      .force("link", forceLink<SimNode, SimLink>(ls).id((d) => d.id).distance((l) => 110 + 60 / Math.sqrt(l.edge.weight)).strength(0.5))
      .force("charge", forceManyBody().strength((d) => ((d as SimNode).type === "item" ? -420 : -220)))
      .force("center", forceCenter(cx, cy))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 14 + labelPad(d)).iterations(2))
      .stop();
    for (let i = 0; i < 400; i++) sim.tick();
    sim.on("tick", () => bump((v) => v + 1));
    simRef.current = sim;
    setNodes(ns);
    setLinks(ls);
    return () => {
      sim.stop();
    };
  }, [data]);

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

  // Fit the graph into the canvas minus the overlaid controls (search/zoom on top, legend at the bottom).
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
    const k = Math.min(1.05, 0.92 / Math.max((x1 - x0) / width, (y1 - y0) / usable));
    const t = zoomIdentity.translate(width / 2 - (k * (x0 + x1)) / 2, top + usable / 2 - (k * (y0 + y1)) / 2).scale(k);
    const sel = select(svg);
    if (animate) sel.transition().duration(300).call(zoomRef.current.transform, t);
    else sel.call(zoomRef.current.transform, t);
  }, [nodes]);
  useEffect(() => {
    // The canvas can still be laying out on the first frame; retry a few times until it has a size.
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
    // Re-fit when the canvas changes size (responsive layouts, rotated phones, embedded views).
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

  // ---- drag ----
  const dragging = useRef<SimNode | null>(null);
  const toGraph = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return transform.invert([e.clientX - rect.left, e.clientY - rect.top]);
  };
  const onNodeDown = (n: SimNode) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    dragging.current = n;
    n.fx = n.x;
    n.fy = n.y;
    simRef.current?.alphaTarget(0.25).restart();
  };
  const onMove = (e: React.PointerEvent) => {
    const n = dragging.current;
    if (!n) return;
    const [x, y] = toGraph(e);
    n.fx = x;
    n.fy = y;
  };
  const onUp = () => {
    const n = dragging.current;
    if (!n) return;
    n.fx = null;
    n.fy = null;
    dragging.current = null;
    simRef.current?.alphaTarget(0);
  };

  // ---- filtering / emphasis ----
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const ok = new Set<string>();
    for (const n of nodes) {
      if (n.type === "entity" && hiddenKinds.has(n.kind)) continue;
      ok.add(n.id);
    }
    return ok;
  }, [nodes, hiddenKinds]);
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
  const kindCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const n of data.nodes) if (n.type === "entity") c.set(n.kind, (c.get(n.kind) ?? 0) + 1);
    return c;
  }, [data]);
  const showLabel = (n: SimNode) => n.type === "item" || nodes.length <= 60 || n.degree >= 2 || n.id === emphasis || (emphasis ? neighbours.get(emphasis)?.has(n.id) : false) || (q && matches(n));

  return (
    <div ref={wrapRef} className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="relative h-[60vh] min-h-[420px] overflow-hidden rounded-lg border border-border/70 bg-card lg:h-[calc(100vh-13rem)]">
        <svg ref={svgRef} className="size-full touch-none select-none" onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp} onClick={() => setSelected(null)}>
          <g transform={transform.toString()}>
            {links.map((l) => {
              const hiddenL = !visible.has(l.source.id) || !visible.has(l.target.id);
              if (hiddenL) return null;
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
                  opacity={emphasis && !lit ? 0.15 : 0.45}
                />
              );
            })}
            {nodes.map((n) => {
              if (!visible.has(n.id)) return null;
              const dim = isDim(n.id) || (q ? !matches(n) : false);
              const sel = n.id === selected;
              return (
                <g
                  key={n.id}
                  data-node
                  transform={`translate(${n.x},${n.y})`}
                  opacity={dim ? 0.22 : 1}
                  className="cursor-grab active:cursor-grabbing"
                  onPointerDown={onNodeDown(n)}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected((s) => (s === n.id ? null : n.id));
                  }}
                >
                  {n.type === "item" ? (
                    <rect x={-n.r} y={-n.r} width={n.r * 2} height={n.r * 2} rx={3} fill="var(--foreground)" stroke={sel ? "var(--time)" : "var(--card)"} strokeWidth={sel ? 2.5 : 2} />
                  ) : (
                    <circle r={n.r} fill={kindColor(n.kind)} stroke={sel ? "var(--time)" : "var(--card)"} strokeWidth={sel ? 2.5 : 2} />
                  )}
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

        <div className="absolute left-3 top-3 flex items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node…" className="h-7 w-52 text-[13px]" aria-label="Find a node" />
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
          <Button variant="outline" size="icon-sm" aria-label="Fit to view" onClick={() => fit()}>
            <Scan />
          </Button>
        </div>
        <div className="absolute bottom-3 left-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border/70 bg-card/90 px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground backdrop-blur">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2.5 rounded-[2px] bg-foreground" /> video
          </span>
          {KIND_ORDER.filter((k) => kindCounts.has(k)).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setHiddenKinds((h) => {
                const n = new Set(h);
                if (n.has(k)) n.delete(k);
                else n.add(k);
                return n;
              })}
              className={`inline-flex items-center gap-1.5 transition-opacity ${hiddenKinds.has(k) ? "opacity-35 line-through" : ""}`}
              aria-pressed={!hiddenKinds.has(k)}
            >
              <span className="inline-block size-2.5 rounded-full" style={{ background: kindColor(k) }} /> {k} <span className="opacity-60">{kindCounts.get(k)}</span>
            </button>
          ))}
          <span className="opacity-60">· dashed = contested</span>
        </div>
      </div>

      <aside className="min-w-0 space-y-4 lg:h-[calc(100vh-13rem)] lg:overflow-y-auto lg:pr-1">
        {selectedNode ? (
          <NodePanel node={selectedNode} links={links} onSelect={setSelected} />
        ) : (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p className="font-mono text-[11px] uppercase tracking-[0.14em]">This namespace</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
              <dt>videos</dt>
              <dd className="text-foreground">{data.stats.items}</dd>
              <dt>entities</dt>
              <dd className="text-foreground">
                {data.stats.entities}
                {data.stats.truncated_entities > 0 ? ` (+${data.stats.truncated_entities} hidden)` : ""}
              </dd>
              <dt>mentions</dt>
              <dd className="text-foreground">{data.stats.mentions}</dd>
            </dl>
            <p className="reading text-[15px] leading-relaxed">Click a node to see what connects to it. Squares are videos; circles are the papers, tools, people and techniques they mention — bigger means mentioned more. A dashed edge means at least one claim there opposes the entity.</p>
          </div>
        )}
      </aside>
    </div>
  );
}

function NodePanel({ node, links, onSelect }: { node: SimNode; links: SimLink[]; onSelect: (id: string) => void }) {
  const mine = links.filter((l) => l.source.id === node.id || l.target.id === node.id).sort((a, b) => b.edge.weight - a.edge.weight);
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {node.type === "item" ? <span className="inline-block size-2.5 rounded-[2px] bg-foreground" /> : <span className="inline-block size-2.5 rounded-full" style={{ background: kindColor(node.kind) }} />}
          {node.type === "item" ? "video" : node.kind}
        </p>
        <h2 className="reading text-[20px] font-semibold leading-snug tracking-tight">{node.label}</h2>
        {node.type === "item" ? (
          <p className="font-mono text-xs text-muted-foreground">
            {node.channel}
            {node.duration_s ? ` · ${fmtTs(node.duration_s)}` : ""}
          </p>
        ) : (
          <p className="font-mono text-xs text-muted-foreground">
            {node.degree} video{node.degree === 1 ? "" : "s"} · {node.mentions} mention{node.mentions === 1 ? "" : "s"}
            {node.aliases.length ? ` · aka ${node.aliases.slice(0, 3).join(", ")}` : ""}
          </p>
        )}
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
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{node.type === "item" ? "Mentions" : "Appears in"}</p>
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {mine.map((l) => {
            const other = l.source.id === node.id ? l.target : l.source;
            const s = l.edge.stances;
            const stance = s.opposes && s.supports ? "contested" : s.opposes ? "opposes" : s.supports ? "supports" : null;
            const href = other.type === "item" ? `/items/${other.id}${l.edge.t_first !== null ? `?t=${Math.floor(l.edge.t_first)}` : ""}` : null;
            return (
              <li key={l.edge.id} className="flex items-start gap-3 py-2">
                <button type="button" onClick={() => onSelect(other.id)} className="mt-1.5 shrink-0" aria-label={`Select ${other.label}`}>
                  {other.type === "item" ? <span className="block size-2.5 rounded-[2px] bg-foreground" /> : <span className="block size-2.5 rounded-full" style={{ background: kindColor(other.kind) }} />}
                </button>
                <div className="min-w-0 flex-1">
                  {href ? (
                    <Link href={href} className="reading block truncate text-[15px] hover:underline">
                      {other.label}
                    </Link>
                  ) : (
                    <button type="button" onClick={() => onSelect(other.id)} className="block max-w-full truncate text-left text-[14px] hover:underline">
                      {other.label}
                    </button>
                  )}
                  <p className="font-mono text-[11px] text-muted-foreground">
                    {l.edge.weight} mention{l.edge.weight === 1 ? "" : "s"}
                    {stance ? ` · ${stance}` : ""}
                    {l.edge.t_first !== null ? ` · first at ${fmtTs(l.edge.t_first)}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
          {mine.length === 0 && <li className="py-2 text-sm text-muted-foreground">No connections yet.</li>}
        </ul>
      </div>
    </div>
  );
}
