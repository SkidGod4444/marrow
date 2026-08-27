import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Graph", description: "Knowledge graphs of your namespaces." };

/** Navbar entry point: graphs are per namespace — one namespace jumps straight in, several get a picker. */
export default async function GraphIndexPage() {
  const namespaces = await api.namespaces();
  const withGraph = namespaces.filter((n) => n.readyCount > 0);
  if (withGraph.length === 1) redirect(`/namespaces/${encodeURIComponent(withGraph[0]!.name)}/graph`);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Knowledge graph</p>
        <h1 className="reading text-[28px] font-semibold tracking-tight">Pick a namespace</h1>
        <p className="text-sm text-muted-foreground">Each namespace has its own graph: items and the papers, tools, people and techniques they mention.</p>
      </header>
      {withGraph.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-14 text-center">
          <p className="text-sm font-medium">Nothing to draw yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The graph appears once a namespace has a ready item.{" "}
            <Link href="/library" className="underline underline-offset-[3px] hover:text-foreground">
              Add something in the library
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border/70 border-y border-border/70">
          {withGraph.map((ns) => (
            <li key={ns.id}>
              <Link href={`/namespaces/${encodeURIComponent(ns.name)}/graph`} className="flex items-center gap-4 py-4 hover:bg-muted/40">
                <span className="reading min-w-0 flex-1 truncate text-[17px]">{ns.name}</span>
                {ns.description && <span className="hidden max-w-[24rem] truncate text-sm text-muted-foreground sm:block">{ns.description}</span>}
                <span className="font-mono text-xs text-muted-foreground">
                  {ns.readyCount} item{ns.readyCount === 1 ? "" : "s"}
                </span>
                <span className="text-muted-foreground">→</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
