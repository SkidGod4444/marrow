import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { SITE_DESCRIPTION, SITE_URL } from "@/lib/seo";

// The front door: what visitors see at "/" (proxy.ts rewrites "/" here without a session; the signed-in get the inbox).
export const revalidate = 3600;

const TITLE = "Marrow — talks, lectures and podcasts, turned into searchable knowledge";
export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 } },
  openGraph: { type: "website", url: SITE_URL, siteName: "Marrow", title: TITLE, description: SITE_DESCRIPTION },
  twitter: { card: "summary_large_image", title: TITLE, description: SITE_DESCRIPTION },
};

const STEPS = [
  { t: "00:00", title: "Paste a link", body: "A YouTube talk, a podcast feed, an article, a paper. Follow a channel and new uploads arrive on their own." },
  { t: "00:04", title: "Transcribed, word by word", body: "Every word carries its own timestamp, so a citation can point at a second, not a chapter. Speakers are told apart." },
  { t: "00:09", title: "The slides, read", body: "Keyframes are kept only where the picture changes, then captioned and their text extracted." },
  { t: "00:12", title: "The article", body: "Sections at the turns of the argument, a summary, the takeaways — and the papers, tools and people it mentions, resolved to links." },
  { t: "00:15", title: "Ask it anything", body: "A research chat over one talk or a whole namespace. Every answer cites title @ 12:34, and the player jumps there." },
  { t: "00:18", title: "What is actually new", body: "Each incoming video is checked against what you already have: known ground, or genuinely new — pointer by pointer." },
];

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
    featureList: ["Word-timestamped transcripts", "Articles with resolved references", "Research chat with timestamped citations", "Knowledge graph", "MCP server for Claude Code"],
  },
];

export default async function LandingPage() {
  const sample = (await api.publicItems().catch(() => []))[0] ?? null;
  return (
    <div className="space-y-24 pb-16 sm:space-y-32">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD).replace(/</g, "\\u003c") }} />

      {/* ---- Hero: the painting, the word cut from it, the thesis ---- */}
      <section aria-labelledby="thesis">
        <div className="landing-rise flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Talks · Lectures · Podcasts</span>
          <span className="hidden sm:inline">Read · Ask · Cite</span>
        </div>
        <figure className="landing-rise mt-5" style={{ "--rise-delay": "0.1s" } as React.CSSProperties}>
          <div className="relative overflow-hidden rounded-lg border border-border/70 bg-card" style={{ "--hero-image": "url(/landing/socrates.jpg)" } as React.CSSProperties}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/landing/socrates.jpg"
              alt="Jacques-Louis David, The Death of Socrates (1787): Socrates, seated, points upward mid-argument while his followers grieve around him."
              width={2000}
              height={1331}
              className="hero-painting block w-full"
              fetchPriority="high"
            />
            <p className="hero-word" aria-hidden>
              MARROW
            </p>
          </div>
          <figcaption className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Jacques-Louis David, <em className="not-italic">The Death of Socrates</em>, 1787 · The Met, public domain
          </figcaption>
        </figure>
        <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:gap-14">
          <h1 id="thesis" className="landing-rise reading text-[34px] font-semibold leading-[1.04] tracking-[-0.015em] sm:text-[46px] lg:text-[54px]" style={{ "--rise-delay": "0.25s" } as React.CSSProperties}>
            The marrow of every talk.
          </h1>
          <div className="landing-rise space-y-5" style={{ "--rise-delay": "0.35s" } as React.CSSProperties}>
            <p className="reading text-[17px] leading-relaxed text-foreground/85 sm:text-[18px]">
              Two hours of video become a fifteen-minute article you can read, a transcript you can search to the word, and a research chat that answers with citations to the second. What was said, where, by whom — and what in it is new to you.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" nativeButton={false} render={<Link href="/signup" />}>
                Create an account
                <ArrowRight data-icon="inline-end" />
              </Button>
              <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/login" />}>
                Sign in
              </Button>
              {sample && (
                <Link href={`/items/${sample.id}/read`} className="ml-1 text-[13px] text-muted-foreground underline-offset-[3px] hover:text-foreground hover:underline">
                  Read a shared page →
                </Link>
              )}
            </div>
            <p className="font-mono text-[11px] text-muted-foreground">Open sign-up · workspaces with roles · open source (AGPL-3.0)</p>
          </div>
        </div>
      </section>

      {/* ---- The pipeline, on a timeline: what the product does, in its own vocabulary ---- */}
      <section aria-labelledby="how" className="grid gap-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">From a link to a text you can cite</p>
          <h2 id="how" className="reading text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">
            Eighteen minutes, for an hour of video.
          </h2>
          <p className="reading text-[16px] leading-relaxed text-foreground/80">Everything runs on hosted models — no GPU to babysit — for about fifty cents an hour of video. Every stage keeps its timestamps, so nothing you read loses its place in the recording.</p>
        </div>
        <ol className="relative ml-1 space-y-9 border-l border-border/70 pl-14 sm:pl-16">
          {STEPS.map((s) => (
            <li key={s.t} className="relative">
              <span className="timecode absolute top-0.5 -left-[3.25rem] sm:-left-[3.75rem]" aria-hidden>
                {s.t}
              </span>
              <span className="sr-only">{s.t} — </span>
              <h3 className="reading text-[20px] font-semibold leading-snug tracking-tight">{s.title}</h3>
              <p className="reading mt-1 max-w-xl text-[16px] leading-relaxed text-foreground/80">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---- Built for research: the Forum behind three surfaces ---- */}
      <section aria-labelledby="surfaces" className="relative left-1/2 w-screen -translate-x-1/2 overflow-hidden border-y border-border/70">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/landing/forum.jpg" alt="" aria-hidden loading="lazy" width={1600} height={1201} className="absolute inset-0 h-full w-full object-cover object-[center_40%] opacity-[0.3] saturate-[0.55]" />
        <div className="absolute inset-0 bg-linear-to-b from-background via-background/35 to-background" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-5 sm:py-24">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Built for research, not for scrolling</p>
          <h2 id="surfaces" className="reading mt-3 max-w-2xl text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">
            Three ways into the same knowledge.
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-3 sm:gap-10">
            {[
              { k: "Reader", h: "The talk as an article", p: "Sections at the topic shifts, a summary, takeaways, references — each section keeps its timecode, and the player follows along." },
              { k: "Research chat", h: "Answers that cite", p: "Ask one talk, or a whole namespace. Every claim comes back as title @ MM:SS; click it and you are there. It can look at the slide, too." },
              { k: "Knowledge graph", h: "Where speakers disagree", p: "Papers, tools, techniques and people across every video, with the claims made about them — and the ones that contradict each other." },
            ].map((c) => (
              <div key={c.k} className="space-y-2 border-t border-border/70 pt-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{c.k}</p>
                <h3 className="reading text-[20px] font-semibold leading-snug tracking-tight">{c.h}</h3>
                <p className="reading text-[15px] leading-relaxed text-foreground/80">{c.p}</p>
              </div>
            ))}
          </div>
          <p className="mt-12 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Word-level timestamps · Hybrid search · MCP server for Claude Code · Namespaces that follow channels · Novelty triage · Language mode
          </p>
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
            Giovanni Battista Piranesi, <em className="not-italic">Veduta di Campo Vaccino</em>, c. 1775 · The Met, public domain
          </p>
        </div>
      </section>

      {/* ---- Yours: workspaces, sharing, source ---- */}
      <section aria-labelledby="yours" className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)] lg:items-center lg:gap-14">
        <div className="space-y-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Yours to keep</p>
          <h2 id="yours" className="reading text-[28px] font-semibold leading-tight tracking-tight sm:text-[34px]">
            A library that outlasts the feed.
          </h2>
          <ul className="reading space-y-3 text-[16px] leading-relaxed text-foreground/85">
            <li>
              <strong className="font-semibold text-foreground">Workspaces with roles.</strong> Invite viewers, members and admins; every workspace has its own namespaces and API keys.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Share pages anyone can read.</strong> Every item has a public page — article, transcript, player — that search engines can index.
            </li>
            <li>
              <strong className="font-semibold text-foreground">Yours to run.</strong> Open source under AGPL-3.0, one Postgres, one object store, hosted models. Connect Claude Code over MCP and research your library from the terminal.
            </li>
          </ul>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="lg" nativeButton={false} render={<Link href="/signup" />}>
              Create an account
              <ArrowRight data-icon="inline-end" />
            </Button>
            <Button size="lg" variant="ghost" nativeButton={false} render={<Link href="/login" />}>
              I have one
            </Button>
          </div>
        </div>
        <figure className="space-y-2">
          <div className="overflow-hidden rounded-lg border border-border/70 bg-card">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/landing/pantheon.jpg" alt="Piranesi's etching of the Pantheon: the portico's columns and the inscription, a crowd in the square before it." loading="lazy" width={1200} height={860} className="aspect-[4/3] w-full object-cover brightness-[0.85] saturate-[0.7]" />
          </div>
          <figcaption className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Giovanni Battista Piranesi, <em className="not-italic">Veduta del Pantheon d'Agrippa</em> · The Met, public domain
          </figcaption>
        </figure>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-border/70 pt-6 font-mono text-[11px] text-muted-foreground">
        <span>Marrow · a video-first research knowledge platform</span>
        <span className="flex flex-wrap gap-4">
          <Link href="/login" className="hover:text-foreground">
            Sign in
          </Link>
          <Link href="/signup" className="hover:text-foreground">
            Create an account
          </Link>
          <span>Paintings and etchings: The Metropolitan Museum of Art, Open Access (CC0)</span>
        </span>
      </footer>
    </div>
  );
}
