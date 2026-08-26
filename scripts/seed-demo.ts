// Dev only: seed a namespace with fake-pipeline items (no yt-dlp/OpenAI) so the web app can be exercised offline.
//   bun run scripts/seed-demo.ts [count]
// Uses the same DATABASE_URL / storage settings as the server (PGlite + local storage by default).
import { createDb, createIngest, createNamespace, createStorage, fakeProviders, getNamespace, loadConfig, runJob } from "@marrow/core";

const config = loadConfig();
const count = Number(process.argv[2] ?? 3);
const { db, close } = await createDb({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
const storage = createStorage(config);
const ns = (await getNamespace(db, "demo")) ?? (await createNamespace(db, { name: "demo", description: "Fake items seeded by scripts/seed-demo.ts" }));
const topics = ["kv cache compression", "sim-to-real actuator backlash", "speculative decoding tricks", "flash attention tiling", "domain randomization limits"];
for (const topic of topics.slice(0, count)) {
  const res = await createIngest(db, { namespace: ns.name, url: `https://www.youtube.com/watch?v=${topic.replace(/ /g, "-")}` });
  if (res.reused && res.job.state === "done") {
    console.log(`skip ${res.item.id} (${topic}) — already ready`);
    continue;
  }
  await runJob({ db, storage, config, providers: fakeProviders({ durationS: 1500 }), log: () => undefined }, res.job.id);
  console.log(`seeded ${res.item.id} — ${topic}`);
}
await close();
