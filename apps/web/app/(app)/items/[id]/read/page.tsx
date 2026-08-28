import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ReadView } from "@/components/marrow/read-view";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/items/[id]/read">): Promise<Metadata> {
  const { id } = await params;
  const item = await api.item(id).catch(() => null);
  if (!item) return { title: "Read" };
  const description = item.summary ? (item.summary.length > 180 ? `${item.summary.slice(0, 177)}…` : item.summary) : `Text version of ${item.title}`;
  return { title: item.title, description, openGraph: { type: "article", title: item.title, description, url: `/items/${item.id}/read` }, twitter: { card: "summary_large_image", title: item.title, description } };
}

/** The shared page: the item as a document, with a hideable player and timecodes that seek it (PRD §6.2). */
export default async function ReadPage({ params }: PageProps<"/items/[id]/read">) {
  const { id } = await params;
  const item = await api.item(id).catch(() => null);
  if (!item || item.status !== "ready") notFound();
  const doc = await api.document(id);
  void api.event(id, "read");
  return <ReadView doc={doc} />;
}
