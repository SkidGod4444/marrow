import { OG_SIZE, renderOg } from "@/lib/og";
import { api } from "@/lib/api";
import { fmtTs } from "@/lib/time";

export const alt = "Marrow item";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await api.item(id).catch(() => null);
  if (!item) return renderOg({ eyebrow: "Item", title: "Not found" });
  const d = item.durationS ?? 0;
  const marks = d > 0 ? [0, Math.floor(d * 0.37), Math.floor(d * 0.82)].map(fmtTs) : undefined;
  return renderOg({
    eyebrow: item.sourceType.replace(/_/g, " "),
    title: item.title || item.sourceUrl,
    meta: [item.channel, d ? fmtTs(d) : null, item.language?.toUpperCase() ?? null].filter((m): m is string => Boolean(m)),
    timecodes: marks,
    footer: item.summary ? `${item.summary.slice(0, 60)}${item.summary.length > 60 ? "…" : ""}` : undefined,
  });
}
