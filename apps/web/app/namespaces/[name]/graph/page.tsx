import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KnowledgeGraph } from "@/components/marrow/knowledge-graph";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/namespaces/[name]/graph">): Promise<Metadata> {
  const { name } = await params;
  return { title: `${decodeURIComponent(name)} · graph` };
}

export default async function GraphPage({ params, searchParams }: PageProps<"/namespaces/[name]/graph">) {
  const { name } = await params;
  const sp = await searchParams;
  const focus = typeof sp.focus === "string" ? sp.focus : null;
  const graph = await api.graph(decodeURIComponent(name)).catch(() => null);
  if (!graph) notFound();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <div className="space-y-1">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Knowledge graph</p>
          <h1 className="reading text-[28px] font-semibold tracking-tight">{graph.namespace.name}</h1>
        </div>
        <Link href="/" className="text-[13px] text-muted-foreground underline-offset-[3px] hover:text-foreground hover:underline">
          ← Library
        </Link>
      </header>
      <KnowledgeGraph data={graph} focus={focus} />
    </div>
  );
}
