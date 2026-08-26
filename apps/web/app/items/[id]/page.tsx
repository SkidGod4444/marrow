import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { ItemView } from "@/components/marrow/item-view";
import { api } from "@/lib/api";
import { fmtTs } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/items/[id]">): Promise<Metadata> {
  const { id } = await params;
  const item = await api.item(id).catch(() => null);
  return { title: item?.title || "Item" };
}

export default async function ItemPage({ params, searchParams }: PageProps<"/items/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tParam = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const initialT = tParam && /^\d+(\.\d+)?$/.test(tParam) ? Number(tParam) : null;
  const item = await api.item(id).catch(() => null);
  if (!item) notFound();
  if (item.status !== "ready") {
    return (
      <div className="space-y-3">
        <h1 className="reading text-2xl font-semibold tracking-tight">{item.title || item.sourceUrl}</h1>
        <p className="text-sm text-muted-foreground">
          This item is <span className="font-mono">{item.status}</span>. The reader and chat appear once ingestion finishes.{" "}
          <Link href="/" className="underline underline-offset-[3px]">
            Back to the library
          </Link>
        </p>
      </div>
    );
  }
  const doc = await api.document(id);
  void api.event(id, "read");

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="reading max-w-4xl text-[30px] font-semibold leading-[1.15] tracking-[-0.01em]">{doc.title}</h1>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          {doc.channel && <span>{doc.channel}</span>}
          {doc.published_at && <span>{doc.published_at.slice(0, 10)}</span>}
          {doc.duration_s ? <span>{fmtTs(doc.duration_s)}</span> : null}
          {doc.language && <span className="uppercase">{doc.language}</span>}
          {doc.frames.length > 0 && <span>{doc.frames.length} keyframes</span>}
          <a href={doc.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
            source
            <ArrowUpRight className="size-3" />
          </a>
          <Link href={`/namespaces/${encodeURIComponent(item.namespaceId)}/graph?focus=${item.id}`} className="hover:text-foreground">
            graph →
          </Link>
        </p>
      </header>
      <ItemView doc={doc} initialT={initialT} />
    </div>
  );
}
