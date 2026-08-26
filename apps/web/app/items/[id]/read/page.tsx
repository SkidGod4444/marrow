import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { ReadToolbar } from "@/components/marrow/read-toolbar";
import { SpeakerDot } from "@/components/marrow/speakers";
import { api } from "@/lib/api";
import { fmtDate, fmtTs } from "@/lib/time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/items/[id]/read">): Promise<Metadata> {
  const { id } = await params;
  const item = await api.item(id).catch(() => null);
  return { title: item?.title ? `${item.title} — text` : "Read" };
}

type Paragraph = { speaker: string; t_start: number; t_end: number; text: string };

/** The item as a document you can read straight through, print, or share — speaker-labelled dialogue for podcasts. */
export default async function ReadPage({ params }: PageProps<"/items/[id]/read">) {
  const { id } = await params;
  const item = await api.item(id).catch(() => null);
  if (!item || item.status !== "ready") notFound();
  const doc = await api.document(id);
  void api.event(id, "read");

  const entries = doc.transcript ?? [];
  const paragraphs: Paragraph[] = [];
  for (const e of entries) {
    const text = e.text.trim();
    if (!text) continue;
    const last = paragraphs[paragraphs.length - 1];
    if (last && last.speaker === e.speaker && last.text.length + text.length < 700) {
      last.text += ` ${text}`;
      last.t_end = e.t_end;
    } else paragraphs.push({ speaker: e.speaker, t_start: e.t_start, t_end: e.t_end, text });
  }
  const speakers = doc.speakers;
  const labelOf = (id: string) => speakers.find((s) => s.id === id)?.label ?? id;
  const multi = new Set(entries.map((e) => e.speaker)).size > 1;

  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <div data-no-print className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/items/${id}`} className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" />
          Back to the video
        </Link>
        <ReadToolbar itemId={id} title={doc.title} />
      </div>

      <header className="space-y-3">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Text version</p>
        <h1 className="reading text-[30px] font-semibold leading-[1.15] tracking-[-0.01em] sm:text-[34px]">{doc.title}</h1>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-muted-foreground">
          {doc.channel && <span>{doc.channel}</span>}
          {doc.published_at && <span>{fmtDate(doc.published_at)}</span>}
          {doc.duration_s ? <span>{fmtTs(doc.duration_s)}</span> : null}
          <a href={doc.source_url} target="_blank" rel="noreferrer" className="hover:text-foreground">
            {doc.source_url.replace(/^https?:\/\/(www\.)?/, "")}
          </a>
        </p>
      </header>

      {doc.article && (
        <section className="space-y-4 border-y border-border/70 py-6">
          <p className="reading text-[19px] leading-[1.6]">{doc.article.summary}</p>
          {doc.article.takeaways.length > 0 && (
            <ul className="space-y-1.5 border-l border-border pl-4">
              {doc.article.takeaways.map((t, i) => (
                <li key={i} className="reading text-[16px] leading-relaxed">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {multi && (
        <section className="flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          <span>Speakers</span>
          {speakers.map((s, i) => (
            <span key={s.id} className="inline-flex items-center gap-1.5 normal-case tracking-normal">
              <SpeakerDot index={i} />
              <span className="font-sans text-[13px] text-foreground">{s.label}</span>
            </span>
          ))}
        </section>
      )}

      <section className="space-y-6">
        {paragraphs.length === 0 && <p className="text-sm text-muted-foreground">No transcript.</p>}
        {paragraphs.map((p, i) => {
          const idx = Math.max(0, speakers.findIndex((s) => s.id === p.speaker));
          return (
            <div key={i} className="grid gap-1.5 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-5">
              <div className="flex items-center gap-2 sm:flex-col sm:items-start sm:pt-1">
                <Link href={`/items/${id}?t=${Math.floor(p.t_start)}`} className="timecode" title="Open the video here">
                  {fmtTs(p.t_start)}
                </Link>
                {multi && (
                  <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                    <SpeakerDot index={idx} />
                    <span className="truncate">{labelOf(p.speaker)}</span>
                  </span>
                )}
              </div>
              <p className="reading text-[17px] leading-[1.7]">{p.text}</p>
            </div>
          );
        })}
      </section>

      {doc.references.length > 0 && (
        <section className="space-y-2 border-t border-border/70 pt-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">References</p>
          <ul className="space-y-1 text-sm">
            {doc.references.map((r, i) => (
              <li key={i} className="reading text-[15px]">
                {r.resolved_url ? (
                  <a href={r.resolved_url} target="_blank" rel="noreferrer" className="underline decoration-foreground/30 underline-offset-[3px]">
                    {r.name}
                  </a>
                ) : (
                  r.name
                )}
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">{r.kind}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
