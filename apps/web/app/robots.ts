import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// The app itself stays out of search engines; the public share pages and the front door are in.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/$", "/welcome", "/items/*/read", "/login", "/signup", "/brand/", "/landing/", "/_next/static/"], disallow: ["/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
