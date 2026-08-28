import type { MetadataRoute } from "next";
import { api } from "@/lib/api";
import { SITE_URL } from "@/lib/seo";

export const revalidate = 3600;

/** Every public share page, newest first, plus the front door. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const items = await api.publicItems().catch(() => []);
  return [
    { url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/login`, changeFrequency: "monthly", priority: 0.3 },
    ...items.map((i) => ({ url: `${SITE_URL}/items/${i.id}/read`, lastModified: new Date(i.updatedAt), changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
