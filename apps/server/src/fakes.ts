// Offline mode for the whole app (E2E tests, UI work): fake pipeline providers, fake retrieval, a scripted chat
// model, and a seeded corpus. Enabled with MARROW_FAKE=1 — never in production.
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import {
  type Config, type Db, type Storage, createCapture, createIngest, createNamespace, fakeEmbedding, fakeListing, fakePage, fakeProviders, getOrganization, listNamespaces, parseFeed, runJob, setItemMetadata,
} from "@marrow/core";
import type { Auth } from "./auth.ts";
import type { ServerDeps } from "./deps.ts";

export const FAKE_USERS = {
  owner: { email: "owner@marrow.local", password: "marrow-owner", name: "Ada Owner" },
  member: { email: "member@marrow.local", password: "marrow-member", name: "Max Member" },
  viewer: { email: "viewer@marrow.local", password: "marrow-viewer", name: "Vic Viewer" },
} as const;
export const FAKE_WORKSPACE = { name: "Demo Lab", slug: "demo-lab" };

/** Three accounts (each with a personal workspace) and one shared workspace where they are owner / member / viewer. */
export async function seedFakeAccounts(db: Db, auth: Auth, log: (m: string) => void): Promise<{ organizationId: string }> {
  const existing = await getOrganization(db, FAKE_WORKSPACE.slug);
  if (existing) {
    log("fake accounts already present");
    return { organizationId: existing.id };
  }
  const ids: Record<string, string> = {};
  for (const [role, u] of Object.entries(FAKE_USERS)) {
    const r = await auth.api.signUpEmail({ body: u });
    ids[role] = r.user.id;
    log(`${role}: ${u.email} / ${u.password}`);
  }
  const org = await auth.api.createOrganization({ body: { name: FAKE_WORKSPACE.name, slug: FAKE_WORKSPACE.slug, userId: ids.owner! } });
  if (!org) throw new Error("could not create the fake workspace");
  await auth.api.addMember({ body: { organizationId: org.id, userId: ids.member!, role: "member" } });
  await auth.api.addMember({ body: { organizationId: org.id, userId: ids.viewer!, role: "viewer" } });
  log(`workspace ${FAKE_WORKSPACE.slug}: owner + member + viewer`);
  return { organizationId: org.id };
}

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel><title>Robot Talk</title><link>https://robottalk.example.com</link>
<item><title>Ep 4: Contact models</title><link>https://robottalk.example.com/ep4</link><guid>ep4</guid><pubDate>Mon, 09 Mar 2026 10:00:00 GMT</pubDate><enclosure url="https://cdn.example.com/ep4.mp3" type="audio/mpeg"/></item>
<item><title>Ep 3: Backlash</title><link>https://robottalk.example.com/ep3</link><guid>ep3</guid><pubDate>Mon, 02 Mar 2026 10:00:00 GMT</pubDate><enclosure url="https://cdn.example.com/ep3.mp3" type="audio/mpeg"/></item>
</channel></rss>`;

/** Streams a plausible cited answer; namespace chats get a cross-item citation, item chats a timestamp. */
function fakeChatModel() {
  return new MockLanguageModelV3({
    doStream: async ({ prompt }) => {
      const sys = prompt.find((m) => m.role === "system");
      const system = typeof sys?.content === "string" ? sys.content : "";
      const last = prompt.toReversed().find((m) => m.role === "user");
      const question = JSON.stringify(last?.content ?? "");
      const ns = /namespace "/.test(system);
      const ids = [...system.matchAll(/^- (\w+_\w+) — (.+?)(?: \(.*\))?$/gm)].map((m) => ({ id: m[1]!, title: m[2]! }));
      const text = ns
        ? `Two items cover this. ${ids[0] ? `[${ids[0].title} @ 05:00](/items/${ids[0].id}?t=300)` : ""} discusses domain randomization; ${ids[1] ? `[${ids[1].title} @ 13:20](/items/${ids[1].id}?t=800)` : ""} covers actuator backlash. ${question.includes("screen") ? "(no screen)" : ""}`
        : `The speaker introduces domain randomization at [00:10] and the Tobin et al. paper at [02:00]${question.includes("screen") ? "; on screen right now is a slide of loss curves" : ""}.`;
      const chunks = text.split(/(?<=\s)/).map((delta) => ({ type: "text-delta" as const, id: "t1", delta }));
      return {
        stream: simulateReadableStream({
          chunkDelayInMs: 5,
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            ...chunks,
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined }, raw: undefined } },
          ],
        }),
      };
    },
  });
}

export function fakeServerDeps(): Pick<ServerDeps, "embedQuery" | "listEntries" | "generate" | "fetchPage" | "fetchFeed" | "chatModel"> & { providers: ReturnType<typeof fakeProviders> } {
  const providers = fakeProviders({ durationS: 1500 });
  return {
    providers,
    embedQuery: async (q) => fakeEmbedding(q),
    listEntries: fakeListing,
    generate: providers.generate,
    fetchPage: async (url) => fakePage(url),
    fetchFeed: async () => parseFeed(FEED),
    chatModel: fakeChatModel(),
  };
}

/** A corpus the UI can be exercised against: videos, a failed one, text captures, a podcast, and a second namespace. */
export async function seedFakeCorpus(deps: { db: Db; storage: Storage; config: Config; providers: ReturnType<typeof fakeProviders>; organizationId?: string }, log: (m: string) => void): Promise<void> {
  const { db, storage, config, providers, organizationId } = deps;
  if ((await listNamespaces(db, organizationId)).length) {
    log("fake corpus already present");
    return;
  }
  const ns = await createNamespace(db, { organizationId, name: "demo", description: "Sim-to-real robot learning" });
  const topics = ["kv cache compression", "sim-to-real actuator backlash", "speculative decoding tricks", "flash attention tiling", "domain randomization limits", "podcast episode 12 interview on robot learning"];
  for (const topic of topics) {
    const res = await createIngest(db, { namespace: ns.id, url: `https://www.youtube.com/watch?v=${topic.replace(/ /g, "-")}` });
    await runJob({ db, storage, config, providers, log: () => undefined }, res.job.id);
  }
  // One that failed mid-way (inbox "Retry" card).
  const failed = await createIngest(db, { namespace: ns.id, url: "https://www.youtube.com/watch?v=broken-download" });
  await runJob({ db, storage, config, providers: fakeProviders({ failAt: "transcribe" }), log: () => undefined }, failed.job.id).catch(() => undefined);
  // Text captures + a podcast episode.
  for (const c of [
    { url: "https://blog.example.com/posts/why-sim-to-real-still-fails" },
    { text: "# Robotics weekly #12\n\nThis week: actuator backlash compensation is finally getting attention. Two new papers model gear backlash explicitly.\n\nAlso worth reading: a long thread on domain randomization limits — https://www.youtube.com/watch?v=dQw4w9WgXcQ has the talk.", title: "Robotics weekly #12", author: "newsletter@example.com", source_type: "newsletter" as const },
  ]) {
    const res = await createCapture({ db, storage, fetchPage: async (u) => fakePage(u) }, { namespace: ns.id, ...c });
    await runJob({ db, storage, config, providers, log: () => undefined }, res.job.id);
  }
  const pod = await createIngest(db, { namespace: ns.id, url: "https://cdn.example.com/robot-talk/ep3.mp3", sourceType: "podcast_episode" });
  await setItemMetadata(db, pod.item.id, { title: "Ep 3: Backlash, with a guest", channel: "Robot Talk", publishedAt: new Date("2026-03-02T10:00:00Z") });
  await runJob({ db, storage, config, providers, log: () => undefined }, pod.job.id);
  // Language mode (PRD §6.3): a namespace flagged language_learning with a podcast → expressions + clips.
  const english = await createNamespace(db, { organizationId, name: "english", description: "Spoken English from podcasts", flags: { language_learning: true } });
  const ep = await createIngest(db, { namespace: english.id, url: "https://cdn.example.com/robot-talk/ep4.mp3", sourceType: "podcast_episode" });
  await setItemMetadata(db, ep.item.id, { title: "Ep 4: Contact models, with two guests", channel: "Robot Talk", publishedAt: new Date("2026-03-09T10:00:00Z") });
  await runJob({ db, storage, config, providers, log: () => undefined }, ep.job.id);
  // A second namespace so switchers and the /graph picker have something to pick.
  const papers = await createNamespace(db, { organizationId, name: "papers", description: "Reading list" });
  const p = await createCapture({ db, storage, fetchPage: async (u) => fakePage(u) }, { namespace: papers.id, url: "https://arxiv.org/abs/1703.06907" });
  await runJob({ db, storage, config, providers, log: () => undefined }, p.job.id);
  log("fake corpus seeded");
}
