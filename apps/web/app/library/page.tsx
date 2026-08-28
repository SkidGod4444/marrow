import Link from "next/link";
import { IngestForm } from "@/components/marrow/ingest-form";
import { LanguageModeToggle } from "@/components/marrow/namespace-flags";
import { Markdown } from "@/components/marrow/markdown";
import { SourcesPanel } from "@/components/marrow/sources-panel";
import { api } from "@/lib/api";
import { kindLabel } from "@/lib/kind";
import { fmtTs } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library", description: "Namespaces, what they follow, and every item in them." };

const STATUS: Record<string, { dot: string; label: string }> = {
  ready: { dot: "bg-foreground", label: "ready" },
  running: { dot: "bg-time animate-pulse", label: "ingesting" },
  queued: { dot: "bg-muted-foreground/40", label: "queued" },
  failed: { dot: "bg-destructive", label: "failed" },
};

export default async function LibraryPage() {
  const namespaces = await api.namespaces();
  const [itemsByNs, sourcesByNs] = await Promise.all([Promise.all(namespaces.map((ns) => api.items(ns.name))), Promise.all(namespaces.map((ns) => api.sources(ns.name)))]);
  const total = itemsByNs.flat().length;

  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div>
          <h1 className="reading text-[28px] font-semibold tracking-tight">Library</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {namespaces.length} namespace{namespaces.length === 1 ? "" : "s"} · {total} item{total === 1 ? "" : "s"}
          </p>
        </div>
        <IngestForm namespaces={namespaces.map((n) => n.name)} />
      </div>

      {namespaces.length === 0 && (
        <div className="rounded-lg border border-dashed px-6 py-14 text-center">
          <p className="text-sm font-medium">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Type a namespace name and paste a link above — a YouTube video, an article, a paper, or a podcast feed.</p>
        </div>
      )}

      {namespaces.map((ns, i) => {
        const items = itemsByNs[i]!;
        return (
          <section key={ns.id} className="space-y-4">
            <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h2 className="font-mono text-[13px] font-medium tracking-tight">{ns.name}</h2>
              <span className="font-mono text-xs text-muted-foreground">
                {ns.readyCount}/{ns.itemCount} ready
              </span>
              {ns.description && <span className="text-sm text-muted-foreground">{ns.description}</span>}
              <LanguageModeToggle namespace={ns.name} on={Boolean(ns.flags?.language_learning)} />
              {ns.readyCount > 0 && (
                <span className="ml-auto flex items-center gap-4 text-[13px] text-muted-foreground">
                  <Link href={`/namespaces/${encodeURIComponent(ns.name)}/chat`} className="underline-offset-[3px] hover:text-foreground hover:underline">
                    Chat →
                  </Link>
                  <Link href={`/namespaces/${encodeURIComponent(ns.name)}/graph`} className="underline-offset-[3px] hover:text-foreground hover:underline">
                    Graph →
                  </Link>
                </span>
              )}
            </header>
            {ns.summary && <Markdown className="max-w-3xl text-[14px] text-muted-foreground">{ns.summary}</Markdown>}
            <SourcesPanel namespace={ns.name} sources={sourcesByNs[i]!} />
            {items.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items yet.</p>
            ) : (
              <ul className="divide-y divide-border/70 border-y border-border/70">
                {items.map((item) => {
                  const st = STATUS[item.status] ?? STATUS.queued!;
                  const row = (
                    <>
                      <span className={`size-1.5 shrink-0 rounded-full ${st.dot}`} aria-hidden />
                      <span className="reading min-w-0 flex-1 truncate text-[16px]">{item.title || item.sourceUrl}</span>
                      {item.sourceType !== "youtube_video" && <span className="hidden rounded-md border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wide text-muted-foreground sm:block">{kindLabel(item.sourceType)}</span>}
                      <span className="hidden max-w-[14rem] truncate text-sm text-muted-foreground sm:block">{item.channel}</span>
                      <span className="w-20 text-right font-mono text-xs text-muted-foreground">{item.status === "ready" && item.durationS ? fmtTs(item.durationS) : st.label}</span>
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.status === "ready" ? (
                        <Link href={`/items/${item.id}`} className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-muted/50 sm:gap-4">
                          {row}
                        </Link>
                      ) : (
                        <div className="-mx-2 flex items-center gap-4 px-2 py-3 text-muted-foreground">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
