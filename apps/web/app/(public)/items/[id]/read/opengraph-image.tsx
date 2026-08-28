import { OG_SIZE, renderOg } from "@/lib/og";
import { api } from "@/lib/api";
import { fmtTs } from "@/lib/time";

export const alt = "Marrow — shared item";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await api.publicItem(id).catch(() => null);
  if (!r) return renderOg({ eyebrow: "Item", title: "Not found" });
  const { item, document: doc } = r;
  const d = doc.duration_s ?? 0;
  const marks = d > 0 ? [0, Math.floor(d * 0.37), Math.floor(d * 0.82)].map(fmtTs) : undefined;
  return renderOg({
    eyebrow: doc.source_type.replace(/_/g, " "),
    title: doc.title || item.sourceUrl,
    meta: [doc.channel, d ? fmtTs(d) : null, doc.language?.toUpperCase() ?? null].filter((m): m is string => Boolean(m)),
    timecodes: marks,
    footer: doc.article?.summary ? `${doc.article.summary.slice(0, 60)}${doc.article.summary.length > 60 ? "…" : ""}` : undefined,
  });
}
