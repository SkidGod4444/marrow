import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import { AsciiBrain } from "@/components/marrow/ascii-brain";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/seo";

// The front door: what visitors see at "/" (proxy.ts rewrites "/" here without a session; the signed-in get the inbox).
export const revalidate = 3600;

const TITLE = "Marrow — a research brain grown from what you watch, read and hear";
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  openGraph: { type: "website", url: SITE_URL, siteName: "Marrow", title: TITLE, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: SITE_DESCRIPTION },
};

const JSON_LD = [
  { "@context": "https://schema.org", "@type": "WebSite", name: "Marrow", url: SITE_URL, description: SITE_DESCRIPTION },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Marrow",
    url: SITE_URL,
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    description: SITE_DESCRIPTION,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    featureList: [
      "Podcasts, YouTube, posts, newsletters and papers in one place",
      "Word-timestamped transcripts",
      "Articles with resolved references",
      "Research chat with timestamped citations",
      "Knowledge graph with contested claims",
      "Novelty triage",
      "MCP server for Claude Code",
      "Markdown export for Obsidian",
    ],
  },
];

export default function LandingPage() {
  return (
    <section aria-labelledby="thesis" className="relative left-1/2 -mt-20 -mb-6 flex min-h-dvh w-screen -translate-x-1/2 items-center overflow-hidden sm:-mt-24 sm:-mb-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />
      <div className="grain" aria-hidden />
      {/* the brain, turning behind the words */}
      <AsciiBrain src="/landing/brain-wire.png" className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-[min(96vw,108vh,900px)] -translate-x-1/2 -translate-y-[46%] select-none" />
      <div className="absolute inset-0 bg-radial from-background/40 via-background/10 via-45% to-transparent" aria-hidden />
      <div className="relative mx-auto w-full max-w-6xl px-4 py-24 sm:px-5">
        <h1 id="thesis" className="landing-rise reading mx-auto max-w-4xl text-center text-[38px] font-semibold leading-[1.05] tracking-[-0.02em] sm:text-[54px] lg:text-[60px]">
          <span className="text-muted-foreground">A research brain,</span>
          <br className="hidden sm:block" /> grown from what you consume.
        </h1>
        <p className="landing-rise reading mx-auto mt-6 max-w-xl text-center text-[17px] leading-relaxed text-foreground/75 text-pretty sm:text-[18px]" style={{ "--rise-delay": "0.12s" } as React.CSSProperties}>
          Podcasts, YouTube, posts, newsletters and papers become one body of knowledge — searched to the second, answered with citations, pushed into new research.
        </p>
        <div className="landing-rise mt-9 flex flex-wrap items-center justify-center gap-3" style={{ "--rise-delay": "0.24s" } as React.CSSProperties}>
          <Button size="lg" nativeButton={false} render={<Link href="/signup" />}>
            Grow your research brain
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
      <a
        href="https://saidev.codes"
        target="_blank"
        rel="noreferrer"
        className="landing-rise fixed bottom-5 left-1/2 z-40 -translate-x-1/2 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        style={{ "--rise-delay": "0.5s" } as React.CSSProperties}
      >
        Built by Saidev Dhal
      </a>
    </section>
  );
}
