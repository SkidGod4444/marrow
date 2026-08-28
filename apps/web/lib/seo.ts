import type { Item, VideoDocument } from "@marrow/core";

// Search engines and link previews for the public share pages (/items/:id/read): structured data, canonical URLs.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");
export const SITE_DESCRIPTION = "Marrow turns the podcasts, YouTube tutorials, posts, newsletters and papers you consume into one research brain — searchable to the second, cited to the source, ready to be pushed into new ideas.";

export const youtubeIdOf = (url: string): string | null => {
  const m = /(?:v=|youtu\.be\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1]! : null;
};

/** 649 → "PT10M49S" (schema.org duration). */
export function isoDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s || (!h && !m) ? `${s}S` : ""}`;
}

/** Meta description: the article summary, cut at a word boundary. */
export function describe(text: string | null | undefined, fallback: string, max = 160): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return fallback;
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 40))}…`;
}

type Doc = Pick<VideoDocument, "source_type" | "source_url" | "title" | "channel" | "author" | "published_at" | "duration_s" | "article"> & { transcript?: Array<{ text: string }> | null };

/** JSON-LD for the share page: VideoObject for YouTube, PodcastEpisode for audio, Article for text. */
export function jsonLdFor(item: Pick<Item, "id" | "updatedAt" | "createdAt">, doc: Doc, url: string): Record<string, unknown> {
  const name = doc.title || url;
  const description = describe(doc.article?.summary, name, 300);
  const published = doc.published_at ? new Date(doc.published_at).toISOString() : undefined;
  const by = doc.author || doc.channel || undefined;
  const author = by ? { "@type": doc.author ? "Person" : "Organization", name: by } : undefined;
  const transcript = (doc.transcript ?? []).map((e) => e.text).join(" ").slice(0, 4000) || undefined;
  const base = { "@context": "https://schema.org", name, description, url, ...(author ? { author } : {}), dateModified: new Date(item.updatedAt).toISOString() };
  const yt = doc.source_type === "youtube_video" ? youtubeIdOf(doc.source_url) : null;
  if (yt) {
    return {
      ...base,
      "@type": "VideoObject",
      thumbnailUrl: [`https://i.ytimg.com/vi/${yt}/hqdefault.jpg`],
      ...(published ? { uploadDate: published } : {}),
      ...(doc.duration_s ? { duration: isoDuration(doc.duration_s) } : {}),
      embedUrl: `https://www.youtube.com/embed/${yt}`,
      ...(transcript ? { transcript } : {}),
    };
  }
  if (doc.source_type === "podcast_episode" || doc.source_type === "uploaded_media") {
    return {
      ...base,
      "@type": "PodcastEpisode",
      ...(published ? { datePublished: published } : {}),
      ...(doc.duration_s ? { timeRequired: isoDuration(doc.duration_s) } : {}),
      associatedMedia: { "@type": "AudioObject", contentUrl: doc.source_url },
      ...(transcript ? { transcript } : {}),
    };
  }
  return { ...base, "@type": "Article", headline: name, ...(published ? { datePublished: published } : {}), mainEntityOfPage: url };
}
