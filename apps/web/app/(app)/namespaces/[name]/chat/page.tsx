import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Chat } from "@/components/marrow/chat";
import { Markdown } from "@/components/marrow/markdown";
import { NamespaceSwitcher } from "@/components/marrow/namespace-switcher";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/namespaces/[name]/chat">): Promise<Metadata> {
  const { name } = await params;
  const n = decodeURIComponent(name);
  return { title: `${n} · chat`, description: `Research chat across every video in the ${n} namespace, with timestamped citations.`, openGraph: { title: `${n} — namespace chat`, url: `/namespaces/${name}/chat` } };
}

/** PRD §6.1 per-namespace research chat: summary + entity index as context, the §8 retrieval tools as tools. */
export default async function NamespaceChatPage({ params, searchParams }: PageProps<"/namespaces/[name]/chat">) {
  const { name } = await params;
  const sp = await searchParams;
  const seed = typeof sp.q === "string" && sp.q.trim() ? sp.q.trim() : null;
  const [ns, namespaces] = await Promise.all([api.namespace(decodeURIComponent(name)), api.namespaces().catch(() => [])]);
  if (!ns) notFound();

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Namespace chat</p>
          <NamespaceSwitcher current={ns.name} namespaces={namespaces} page="chat" />
          <p className="font-mono text-[11px] text-muted-foreground">
            {ns.readyCount} item{ns.readyCount === 1 ? "" : "s"}
            {ns.summary ? " · summary ready" : " · no summary yet"}
          </p>
        </div>
        <nav className="flex items-center gap-4 text-[13px] text-muted-foreground">
          <Link href={`/namespaces/${encodeURIComponent(ns.name)}/graph`} className="underline-offset-[3px] hover:text-foreground hover:underline">
            Graph →
          </Link>
          <Link href="/library" className="underline-offset-[3px] hover:text-foreground hover:underline">
            ← Library
          </Link>
        </nav>
      </header>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Chat endpoint={`namespaces/${encodeURIComponent(ns.name)}/chat`} chatId={`ns:${ns.id}`} mode="namespace" seed={seed} />
        <aside className="space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">What this corpus covers</p>
          {ns.summary ? (
            <Markdown className="text-[15px] text-foreground/85">{ns.summary}</Markdown>
          ) : (
            <p className="reading text-[15px] text-muted-foreground">The summary is written after the third ingest and refreshed every three after that.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
