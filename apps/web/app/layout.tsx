import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Research-platform type system: a serif for everything you read, Plex Sans for the chrome, Plex Mono for time + data.
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Marrow", template: "%s · Marrow" },
  description: "Video-first research knowledge base: talks, lectures and podcasts turned into timestamped, searchable, citable knowledge — with a reader, a research chat, and a knowledge graph.",
  applicationName: "Marrow",
  openGraph: { type: "website", siteName: "Marrow", title: "Marrow", description: "Turn talks, lectures and podcasts into searchable, citable knowledge.", locale: "en_US" },
  twitter: { card: "summary_large_image", title: "Marrow", description: "Turn talks, lectures and podcasts into searchable, citable knowledge." },
  robots: { index: false, follow: false }, // single-owner tool; keep it out of search engines
};

export const viewport = { themeColor: "#111111", colorScheme: "dark" as const };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${serif.variable} ${sans.variable} ${mono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
          <TooltipProvider>
            <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-1.5 focus:text-[13px] focus:text-background">
              Skip to content
            </a>
            {children}
            <Toaster position="bottom-right" />
            {/* Vercel Web Analytics — page views only; no-op outside Vercel (local, E2E). */}
            <Analytics />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
