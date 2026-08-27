import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { extractYouTubeUrls } from "../capture/links.ts";
import { assertPublicHttpUrl, htmlToContent, isSocialUrl, normalizeCaptureUrl } from "../capture/page.ts";
import { items, namespaces, segments } from "../db/index.ts";
import { loadDocument, runJob } from "../pipeline/runner.ts";
import { fakePage, fakeProviders, testEnv } from "../pipeline/testkit.ts";
import { InProcessQueue } from "../queue.ts";
import { captureEmail, namespaceFromRecipients, normalizeInboundEmail } from "./email.ts";
import { createCapture, textSourceUrl } from "./capture.ts";
import { documentToMarkdown } from "./export.ts";
import { createNamespace } from "./namespaces.ts";
import { search } from "./search.ts";

describe("capture helpers (PRD §7)", () => {
  it("finds YouTube links in text and link lists, canonicalised and deduplicated", () => {
    const urls = extractYouTubeUrls("see https://youtu.be/dQw4w9WgXcQ?si=abc and https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s", ["https://m.youtube.com/watch?v=aircAruvnKk", "https://example.com"]);
    expect(urls).toEqual(["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/watch?v=aircAruvnKk"]);
  });
  it("normalises arXiv links to the PDF and strips tracking", () => {
    expect(normalizeCaptureUrl("https://arxiv.org/abs/1703.06907v2")).toBe("https://arxiv.org/pdf/1703.06907v2");
    expect(normalizeCaptureUrl("https://blog.example.com/post?utm_source=x&id=3#frag")).toBe("https://blog.example.com/post?id=3");
  });
  it("refuses private hosts and non-http schemes, flags social platforms", () => {
    expect(() => assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).toThrow(/not reachable/);
    expect(() => assertPublicHttpUrl("http://localhost:3001/health")).toThrow(/not reachable/);
    expect(() => assertPublicHttpUrl("file:///etc/passwd")).toThrow(/http/);
    expect(assertPublicHttpUrl("https://example.com/a").hostname).toBe("example.com");
    expect(isSocialUrl("https://x.com/someone/status/1")).toBe(true);
    expect(isSocialUrl("https://www.linkedin.com/posts/abc")).toBe(true);
    expect(isSocialUrl("https://substack.com/p/abc")).toBe(false);
  });
  it("extracts the readable article from HTML with metadata and links", () => {
    const html = `<html><head><title>Site</title><meta property="og:title" content="A post about robots"><meta name="author" content="Ada"><meta property="article:published_time" content="2026-03-01T10:00:00Z"></head>
      <body><nav><a href="/home">home</a></nav><article><h1>A post about robots</h1>${"<p>Robots need domain randomization to cross the reality gap, as Tobin et al. showed. </p>".repeat(6)}<p>Watch <a href="https://youtu.be/dQw4w9WgXcQ">the talk</a>.</p></article></body></html>`;
    const page = htmlToContent(html, "https://blog.example.com/robots");
    expect(page.title).toBe("A post about robots");
    expect(page.author).toBe("Ada");
    expect(page.published_at).toBe("2026-03-01T10:00:00.000Z");
    expect(page.body_md).toContain("domain randomization");
    expect(page.links).toContain("https://youtu.be/dQw4w9WgXcQ");
  });
});

describe("POST /capture → text document → segments", () => {
  let env: Awaited<ReturnType<typeof testEnv>>;
  const queued: string[] = [];
  const queue = new InProcessQueue();
  beforeEach(async () => {
    env = await testEnv();
    await createNamespace(env.db, { name: "posts" });
    queued.length = 0;
    await queue.start(async (id) => {
      queued.push(id);
    });
  });
  afterEach(async () => {
    await queue.stop();
    await env.close();
  });
  const deps = () => ({ db: env.db, storage: env.storage, queue, fetchPage: async (url: string) => fakePage(url) });

  it("captures pasted text idempotently, runs the text pipeline and makes it searchable", async () => {
    const text = "# Backlash notes\n\nActuator backlash ruins sim-to-real transfer unless you model it. Domain randomization helps.\n\nSecond paragraph with more detail about gear backlash and compliance.";
    const r = await createCapture(deps(), { namespace: "posts", text, author: "me", note: "from a forum" });
    expect(r.reused).toBe(false);
    expect(r.item.sourceType).toBe("captured_post");
    expect(r.item.sourceUrl).toBe(textSourceUrl(text));
    expect(r.item.id.startsWith("txt_")).toBe(true);
    const seeded = await loadDocument(env.storage, r.item.id);
    expect(seeded?.body_md).toBe(text);
    expect(seeded?.title).toBe("Backlash notes");
    expect(seeded?.description).toBe("from a forum");

    const providers = fakeProviders();
    const job = await runJob({ ...env, providers }, r.job.id);
    expect(job.state).toBe("done");
    expect(job.stages.transcribe?.state).toBe("skipped");
    expect(job.stages.frames?.state).toBe("skipped");
    expect(job.stages.article?.state).toBe("done");
    expect(job.stages.enrich?.state).toBe("done");
    expect(providers.calls.transcribe).toBeUndefined();
    expect(providers.calls.fetchPage).toBeUndefined();

    const doc = (await loadDocument(env.storage, r.item.id))!;
    expect(doc.has_video).toBe(false);
    expect(doc.article?.sections.every((s) => s.t_start === null)).toBe(true);
    expect(doc.references.every((x) => x.t === null)).toBe(true);
    const segs = await env.db.select().from(segments).where(eq(segments.itemId, r.item.id));
    expect(segs.length).toBeGreaterThan(0);
    expect(segs.every((s) => s.tStart === null && s.sourceType === "captured_post")).toBe(true);
    const [item] = await env.db.select().from(items).where(eq(items.id, r.item.id));
    expect(item?.status).toBe("ready");

    const hits = await search({ db: env.db, config: env.config, embedQuery: env.embedQuery }, { namespace: "posts", query: "gear backlash", k: 5 });
    expect(hits.hits[0]?.item_id).toBe(r.item.id);
    expect(hits.hits[0]?.deep_link).toBe(textSourceUrl(text));

    const again = await createCapture(deps(), { namespace: "posts", text: `  ${text}  ` });
    expect(again.reused).toBe(true);
    expect(again.item.id).toBe(r.item.id);

    const md = documentToMarkdown(doc, { transcript: true });
    expect(md.startsWith("---\ntitle:")).toBe(true);
    expect(md).toContain("type: captured_post");
    expect(md).toContain("## Original text");
  });

  it("captures a URL by fetching the page, offers linked videos, and auto-queues them when the namespace says so", async () => {
    const r = await createCapture(deps(), { namespace: "posts", url: "https://blog.example.com/posts/sim-to-real-tricks?utm_source=tw" });
    expect(r.item.sourceUrl).toBe("https://blog.example.com/posts/sim-to-real-tricks");
    expect(r.item.title).toBe("Post: sim to real tricks");
    expect(r.linked_videos).toEqual(["https://www.youtube.com/watch?v=dQw4w9WgXcQ"]);
    expect(r.queued_videos).toEqual([]);
    expect(queued).toEqual([r.job.id]);

    await env.db.update(namespaces).set({ flags: { auto_ingest_links: true } });
    const r2 = await createCapture(deps(), { namespace: "posts", url: "https://blog.example.com/posts/another-post" });
    expect(r2.queued_videos).toHaveLength(1);
    expect(r2.queued_videos[0]?.url).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    const [vid] = await env.db.select().from(items).where(eq(items.id, r2.queued_videos[0]!.item_id));
    expect(vid?.sourceType).toBe("youtube_video");

    const paper = await createCapture(deps(), { namespace: "posts", url: "https://arxiv.org/abs/1703.06907" });
    expect(paper.item.sourceType).toBe("paper");
    expect(paper.item.sourceUrl).toBe("https://arxiv.org/pdf/1703.06907");
  });

  it("routes a bare YouTube link to the video pipeline and refuses social links without text", async () => {
    const r = await createCapture(deps(), { namespace: "posts", url: "https://youtu.be/aircAruvnKk" });
    expect(r.item.sourceType).toBe("youtube_video");
    await expect(createCapture(deps(), { namespace: "posts", url: "https://x.com/someone/status/123" })).rejects.toThrow(/share the post text/);
    const withText = await createCapture(deps(), { namespace: "posts", url: "https://x.com/someone/status/123", text: "The post text, long enough to count as a capture of the tweet in question here." });
    expect(withText.item.sourceType).toBe("captured_post");
    expect(withText.item.sourceUrl).toBe("https://x.com/someone/status/123");
  });

  it("files inbound email as a newsletter in the plus-tagged namespace", async () => {
    expect(namespaceFromRecipients(["Marrow <inbox+posts@in.example.com>"])).toBe("posts");
    expect(namespaceFromRecipients(["inbox@in.example.com"])).toBe(null);
    const postmark = normalizeInboundEmail({ FromFull: { Email: "news@substack.com", Name: "Weekly" }, ToFull: [{ Email: "abc+posts@inbound.postmarkapp.com" }], Subject: "Issue 12", TextBody: "Hello reader. This week: backlash compensation, domain randomization, and a new paper from Tobin.", HtmlBody: "", MessageID: "<m1@x>", Date: "Mon, 2 Mar 2026 10:00:00 +0000" });
    expect(postmark?.from).toBe("news@substack.com");
    const r = await captureEmail(deps(), postmark!, {});
    expect(r.item.sourceType).toBe("newsletter");
    expect(r.item.sourceUrl).toBe("marrow:email:m1@x");
    expect(r.item.title).toBe("Issue 12");
    const redelivered = await captureEmail(deps(), postmark!, {});
    expect(redelivered.reused).toBe(true);
    const generic = normalizeInboundEmail({ from: "a@b.c", to: "inbox@in.example.com", subject: "Hi", html: "<p>Some html body that is long enough to be captured as text here.</p>" });
    await expect(captureEmail(deps(), generic!, {})).rejects.toThrow(/namespace/);
    const viaDefault = await captureEmail(deps(), generic!, { defaultNamespace: "posts" });
    expect(viaDefault.item.sourceType).toBe("newsletter");
    expect(normalizeInboundEmail({ hello: 1 })).toBe(null);
  });
});
