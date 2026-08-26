import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import Link from "next/link";
import { ThemeProvider } from "next-themes";
import { NavLinks } from "@/components/marrow/nav-links";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Research-platform type system: a serif for everything you read, Plex Sans for the chrome, Plex Mono for time + data.
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

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
            <header className="border-b border-border/70 bg-card">
              <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4 sm:gap-8 sm:px-5">
                <Link href="/" className="flex items-center gap-2.5 font-serif text-[19px] font-semibold tracking-tight">
                  {/* Plain <img>: next/image caches optimised copies by URL and kept serving a stale icon after the file changed. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/brand/marrow-mark.png?v=2" alt="" width={22} height={22} className="size-[22px] rounded-[5px]" />
                  Marrow
                </Link>
                <NavLinks />
              </div>
            </header>
            <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">
              {children}
            </main>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
