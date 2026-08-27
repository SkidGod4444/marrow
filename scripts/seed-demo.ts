// Dev only: seed a namespace with fake-pipeline items (no yt-dlp/OpenAI) so the web app can be exercised offline.
//   bun run scripts/seed-demo.ts [count]
// Uses the same DATABASE_URL / storage settings as the server (PGlite + local storage by default).
import { createCapture, createDb, createIngest, createNamespace, createStorage, fakePage, fakeProviders, getNamespace, loadConfig, runJob, setItemMetadata } from "@marrow/core";

const config = loadConfig();
const count = Number(process.argv[2] ?? 3);
const { db, close } = await createDb({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
const storage = createStorage(config);
const ns = (await getNamespace(db, "demo")) ?? (await createNamespace(db, { name: "demo", description: "Fake items seeded by scripts/seed-demo.ts" }));
const topics = ["kv cache compression", "sim-to-real actuator backlash", "speculative decoding tricks", "flash attention tiling", "domain randomization limits", "podcast episode 12 interview on robot learning"];
for (const topic of topics.slice(0, count)) {
  const res = await createIngest(db, { namespace: ns.name, url: `https://www.youtube.com/watch?v=${topic.replace(/ /g, "-")}` });
  if (res.reused && res.job.state === "done") {
    console.log(`skip ${res.item.id} (${topic}) — already ready`);
    continue;
  }
  await runJob({ db, storage, config, providers: fakeProviders({ durationS: 1500 }), log: () => undefined }, res.job.id);
  console.log(`seeded ${res.item.id} — ${topic}`);
}
// Phase 5: one captured post (fetched page, fake) and one pasted newsletter, plus a podcast episode from a direct URL.
const providers = fakeProviders({ durationS: 1500, hasVideo: false });
const captures = [
  { url: "https://blog.example.com/posts/why-sim-to-real-still-fails" },
  { text: "# Robotics weekly #12\n\nThis week: actuator backlash compensation is finally getting attention. Two new papers model gear backlash explicitly and report better transfer. Also worth reading: a long thread on domain randomization limits — https://www.youtube.com/watch?v=dQw4w9WgXcQ has the talk.\n\nOn the tooling side, MuJoCo 3.2 shipped with better contact models.", title: "Robotics weekly #12", author: "newsletter@example.com", source_type: "newsletter" as const },
];
for (const c of captures) {
  const res = await createCapture({ db, storage, fetchPage: async (u) => fakePage(u) }, { namespace: ns.name, ...c });
  if (res.reused && res.job.state === "done") {
    console.log(`skip ${res.item.id} — already ready`);
    continue;
  }
  await runJob({ db, storage, config, providers, log: () => undefined }, res.job.id);
  console.log(`seeded ${res.item.id} — ${res.item.sourceType}: ${res.item.title}`);
}
const pod = await createIngest(db, { namespace: ns.name, url: "https://cdn.example.com/robot-talk/ep3.mp3", sourceType: "podcast_episode" });
if (!(pod.reused && pod.job.state === "done")) {
  await setItemMetadata(db, pod.item.id, { title: "Ep 3: Backlash, with a guest", channel: "Robot Talk" });
  await runJob({ db, storage, config, providers, log: () => undefined }, pod.job.id);
  console.log(`seeded ${pod.item.id} — podcast episode`);
}
await close();
