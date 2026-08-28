import Link from "next/link";
import { UsageChip } from "@/components/marrow/usage-chip";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { AutoRefresh } from "@/components/marrow/auto-refresh";
import { ItemView } from "@/components/marrow/item-view";
import { api } from "@/lib/api";
import { isWebUrl, kindLabel } from "@/lib/kind";
import { fmtDay, fmtTs } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/items/[id]">): Promise<Metadata> {
  const { id } = await params;
  const item = await api.item(id).catch(() => null);
  if (!item) return { title: "Item" };
  const description = item.summary ? (item.summary.length > 180 ? `${item.summary.slice(0, 177)}…` : item.summary) : `${item.channel ? `${item.channel} · ` : ""}${item.title}`;
  return {
    title: item.title || "Item",
    description,
    openGraph: { type: item.sourceType === "youtube_video" || item.sourceType === "podcast_episode" ? "video.other" : "article", title: item.title, description, url: `/items/${item.id}` },
    twitter: { card: "summary_large_image", title: item.title, description },
  };
}

export default async function ItemPage({ params, searchParams }: PageProps<"/items/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tParam = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  const initialT = tParam && /^\d+(\.\d+)?$/.test(tParam) ? Number(tParam) : null;
  const tab = sp.tab === "chat" || sp.tab === "transcript" || sp.tab === "language" ? sp.tab : "reader";
  const item = await api.item(id).catch(() => null);
  if (!item) notFound();
  if (item.status !== "ready") {
    const failed = item.status === "failed";
    return (
      <div className="space-y-4">
        {!failed && <AutoRefresh active everyMs={4000} />}
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{failed ? "Couldn't finish" : "Still working on it"}</p>
        <h1 className="reading text-2xl font-semibold tracking-tight">{item.title || item.sourceUrl.replace(/^https?:\/\/(www\.)?/, "")}</h1>
        <p className="reading max-w-2xl text-[16px] leading-relaxed text-foreground/85">
          {failed ? "We couldn't finish this one. You can retry it from the inbox — it picks up where it stopped." : "Transcribing, writing the article and finding references usually takes a minute or two. This page updates itself when it's ready."}
        </p>
        {!failed && (
          <p className="inline-flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className="size-1.5 animate-pulse rounded-full bg-time" aria-hidden />
            working…
          </p>
        )}
        <p className="text-sm">
          <Link href="/" className="underline underline-offset-[3px] hover:text-foreground">
            {failed ? "Go to the inbox to retry" : "Back to the inbox"}
          </Link>
        </p>
      </div>
    );
  }
  const [doc, lang, usage] = await Promise.all([api.document(id), api.expressions(id).catch(() => null), api.usage(id).catch(() => null)]);
  void api.event(id, "read");

  return (
    <div className="flex flex-col gap-5 lg:-my-8 lg:h-[calc(100dvh-3rem)] lg:min-h-0 lg:py-6">
      <header className="shrink-0 space-y-2">
        <h1 className="reading max-w-4xl text-[24px] font-semibold leading-[1.15] tracking-[-0.01em] sm:text-[30px]">{doc.title}</h1>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          {doc.source_type !== "youtube_video" && <span className="rounded-md border border-border px-1.5 py-px text-[10px] uppercase tracking-wide">{kindLabel(doc.source_type)}</span>}
          {doc.author && <span>{doc.author}</span>}
          {doc.channel && doc.channel !== doc.author && <span>{doc.channel}</span>}
          {doc.published_at && <span>{fmtDay(doc.published_at)}</span>}
          {doc.duration_s ? <span>{fmtTs(doc.duration_s)}</span> : null}
          {doc.language && <span className="uppercase">{doc.language}</span>}
          {doc.frames.length > 0 && <span>{doc.frames.length} keyframes</span>}
          {usage && <UsageChip usage={usage} />}
          {isWebUrl(doc.source_url) && (
            <a href={doc.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
              source
              <ArrowUpRight className="size-3" />
            </a>
          )}
          <Link href={`/namespaces/${encodeURIComponent(item.namespaceId)}/graph?focus=${item.id}`} className="inline-flex items-center gap-0.5 hover:text-foreground">
            graph
            <ArrowRight className="size-3" />
          </Link>
        </p>
      </header>
      <ItemView doc={doc} expressions={lang?.expressions ?? []} initialT={initialT} initialTab={tab} className="lg:min-h-0 lg:flex-1" />
    </div>
  );
}
