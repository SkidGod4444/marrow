import { OG_SIZE, renderOg } from "@/lib/og";
import { api } from "@/lib/api";

export const alt = "Marrow namespace";
export const size = OG_SIZE;
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const ns = await api.namespace(decodeURIComponent(name)).catch(() => null);
  if (!ns) return renderOg({ eyebrow: "Namespace", title: "Not found" });
  return renderOg({
    eyebrow: "Namespace",
    title: ns.name,
    meta: [`${ns.readyCount} video${ns.readyCount === 1 ? "" : "s"}`, ns.description || null].filter((m): m is string => Boolean(m)),
    footer: ns.summary ? `${ns.summary.replace(/[#*_`]/g, "").slice(0, 70)}…` : undefined,
  });
}
