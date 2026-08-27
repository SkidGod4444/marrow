import { IngestForm } from "./ingest-form";

/** First run: an empty corpus gets a three-step start instead of an empty list. */
export function Welcome({ namespaces }: { namespaces: string[] }) {
  return (
    <section className="rounded-lg border border-border/70 bg-card px-5 py-8 sm:px-8 sm:py-10" aria-labelledby="welcome-title">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Welcome</p>
      <h2 id="welcome-title" className="reading mt-2 text-[24px] font-semibold tracking-tight sm:text-[28px]">
        Turn a video into something you can read, search and ask questions about.
      </h2>
      <ol className="reading mt-5 max-w-2xl space-y-2 text-[16px] leading-relaxed text-foreground/85">
        <li>
          <span className="mr-2 font-mono text-[12px] text-muted-foreground">1</span>Paste a YouTube link, an article, a paper, or a podcast feed below. It goes into a <em>namespace</em> — a folder for one topic.
        </li>
        <li>
          <span className="mr-2 font-mono text-[12px] text-muted-foreground">2</span>Give it a minute. Marrow transcribes it, writes a short article, and finds the papers, tools and people it mentions.
        </li>
        <li>
          <span className="mr-2 font-mono text-[12px] text-muted-foreground">3</span>It lands here, in your inbox: read it, chat with it, or skip it.
        </li>
      </ol>
      <div className="mt-6">
        <IngestForm namespaces={namespaces} />
      </div>
    </section>
  );
}
