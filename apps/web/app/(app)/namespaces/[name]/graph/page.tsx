import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KnowledgeGraph } from "@/components/marrow/knowledge-graph";
import { NamespaceSwitcher } from "@/components/marrow/namespace-switcher";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/namespaces/[name]/graph">): Promise<Metadata> {
  const { name } = await params;
  const n = decodeURIComponent(name);
  return { title: `${n} · graph`, description: `Knowledge graph of the ${n} namespace: items and the papers, tools, people and techniques they mention.`, openGraph: { title: `${n} — knowledge graph`, url: `/namespaces/${name}/graph` } };
}

export default async function GraphPage({ params, searchParams }: PageProps<"/namespaces/[name]/graph">) {
  const { name } = await params;
  const sp = await searchParams;
  const focus = typeof sp.focus === "string" ? sp.focus : null;
  const ref = decodeURIComponent(name);
  const [graph, namespaces] = await Promise.all([api.graph(ref).catch(() => null), api.namespaces().catch(() => [])]);
  if (!graph) notFound();
  const s = graph.stats;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Knowledge graph</p>
          <NamespaceSwitcher current={graph.namespace.name} namespaces={namespaces.filter((n) => n.readyCount > 0 || n.name === graph.namespace.name)} page="graph" />
          <p className="flex flex-wrap items-center gap-x-3 font-mono text-[11px] text-muted-foreground">
            <span>
              <b className="font-medium text-foreground">{s.items}</b> item{s.items === 1 ? "" : "s"}
            </span>
            <span>
              <b className="font-medium text-foreground">{s.entities}</b> entities{s.truncated_entities ? ` (+${s.truncated_entities} hidden)` : ""}
            </span>
            <span>
              <b className="font-medium text-foreground">{s.mentions}</b> mentions
            </span>
            <span>
              <b className="font-medium text-foreground">{s.edges}</b> edges
            </span>
            {s.contested > 0 && (
              <span className="text-time">
                <b className="font-medium">{s.contested}</b> contested
              </span>
            )}
          </p>
        </div>
        <nav className="flex items-center gap-4 text-[13px] text-muted-foreground">
          <Link href={`/namespaces/${encodeURIComponent(graph.namespace.name)}/chat`} className="underline-offset-[3px] hover:text-foreground hover:underline">
            Chat →
          </Link>
          <Link href="/library" className="underline-offset-[3px] hover:text-foreground hover:underline">
            Library →
          </Link>
        </nav>
      </header>
      <KnowledgeGraph data={graph} focus={focus} />
    </div>
  );
}
