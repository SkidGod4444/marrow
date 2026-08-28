import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReadBeacon } from "@/components/marrow/read-beacon";
import { ReadView } from "@/components/marrow/read-view";
import { api } from "@/lib/api";
import { SITE_URL, describe, jsonLdFor } from "@/lib/seo";

// The share page is public: anyone with the link can read it, and search engines may index it (PRD §6.2 sharing).
// Cached for a few minutes (the document only changes on a re-ingest) so crawlers and readers get fast HTML.
export const revalidate = 600;

export async function generateMetadata({ params }: PageProps<"/items/[id]/read">): Promise<Metadata> {
  const { id } = await params;
  const r = await api.publicItem(id).catch(() => null);
  if (!r) return { title: "Not found", robots: { index: false, follow: false } };
  const { item, document: doc } = r;
  const title = doc.title || item.title || "Untitled";
  const description = describe(doc.article?.summary, `${title} — transcript, article and references.`);
  const url = `${SITE_URL}/items/${item.id}/read`;
  return {
    title,
    description,
    alternates: { canonical: url },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1, "max-video-preview": -1 } },
    openGraph: {
      type: "article",
      url,
      title,
      description,
      siteName: "Marrow",
      ...(doc.published_at ? { publishedTime: new Date(doc.published_at).toISOString() } : {}),
      ...(doc.author || doc.channel ? { authors: [doc.author || doc.channel] } : {}),
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function PublicReadPage({ params }: PageProps<"/items/[id]/read">) {
  const { id } = await params;
  const r = await api.publicItem(id).catch(() => null);
  if (!r) notFound();
  const { item, document: doc } = r;
  const url = `${SITE_URL}/items/${item.id}/read`;
  const jsonLd = jsonLdFor(item, doc, url);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <ReadBeacon itemId={item.id} />
      <ReadView doc={doc} mediaBase="/api/marrow/public" />
    </>
  );
}
