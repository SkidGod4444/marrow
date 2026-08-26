import Link from "next/link";
import { InboxList } from "@/components/marrow/inbox-list";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

/** PRD §6.4: the watch inbox is the landing page — what came in, what's new about it, read / chat / skip. */
export default async function InboxPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const ns = typeof sp.ns === "string" && sp.ns ? sp.ns : undefined;
  const [namespaces, inbox] = await Promise.all([api.namespaces(), api.inbox(ns).catch(() => ({ entries: [], pending: [] }))]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="reading text-[28px] font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {inbox.entries.length} to watch{inbox.pending.length ? ` · ${inbox.pending.length} ingesting` : ""}
          </p>
        </div>
        {namespaces.length > 1 && (
          <nav className="flex flex-wrap items-center gap-1.5 text-[13px]" aria-label="Namespace filter">
            <Link href="/" className={`rounded-md border px-2 py-0.5 ${!ns ? "border-border bg-muted/60 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              all
            </Link>
            {namespaces.map((n) => (
              <Link key={n.id} href={`/?ns=${encodeURIComponent(n.name)}`} className={`rounded-md border px-2 py-0.5 font-mono text-xs ${ns === n.name ? "border-border bg-muted/60 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {n.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {namespaces.length === 0 ? (
        <div className="rounded-lg border border-dashed px-6 py-14 text-center">
          <p className="text-sm font-medium">Nothing here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ingest a video or follow a playlist from the{" "}
            <Link href="/library" className="underline underline-offset-[3px]">
              library
            </Link>
            . New items land here with a summary and what&apos;s new about them.
          </p>
        </div>
      ) : (
        <InboxList entries={inbox.entries} pending={inbox.pending} showNamespace={!ns} />
      )}
    </div>
  );
}
