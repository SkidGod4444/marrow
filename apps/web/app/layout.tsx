import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// Research-platform type system: a serif for everything you read, Plex Sans for the chrome, Plex Mono for time + data.
const serif = Source_Serif_4({ variable: "--font-source-serif", subsets: ["latin"], axes: ["opsz"], style: ["normal", "italic"] });
const sans = IBM_Plex_Sans({ variable: "--font-plex-sans", subsets: ["latin"], weight: ["400", "500", "600"] });
const mono = IBM_Plex_Mono({ variable: "--font-plex-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: { default: "Marrow", template: "%s · Marrow" },
  description: "Video-first research knowledge base",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${serif.variable} ${sans.variable} ${mono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
          <TooltipProvider>
            <header className="border-b border-border/70 bg-card">
              <div className="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4 sm:gap-8 sm:px-5">
                <Link href="/" className="flex items-center gap-2.5 font-serif text-[19px] font-semibold tracking-tight">
                  <Image src="/icon-512.png" alt="" width={22} height={22} className="size-[22px] rounded-[5px]" priority />
                  Marrow
                </Link>
                <nav className="flex items-center gap-4 text-[13px] text-muted-foreground sm:gap-5">
                  <Link href="/" className="transition-colors hover:text-foreground">
                    Inbox
                  </Link>
                  <Link href="/library" className="transition-colors hover:text-foreground">
                    Library
                  </Link>
                </nav>
              </div>
            </header>
            <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-5 sm:py-8">{children}</main>
            <Toaster position="bottom-right" />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
