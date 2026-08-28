import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import {
  STAGE_NAMES, type StageName, createCapture, createDb, databaseSsl, createIngest, createNamespace, createProviders, createStorage, getItem,
  getJobStatus, getNamespace, getOrganization, listItems, listNamespaces, loadConfig, loadDocument, runJob,
} from "@marrow/core";

const HELP = `marrow — CLI

  bun run cli ns create <name> [--org <workspace-slug>] [--description "…"] [--language-learning] [--diarize]
  bun run cli ns list [--org <workspace-slug>]
  bun run cli ingest <youtube-url> --ns <name> [--force] [--stages fetch,transcribe,…]
  bun run cli capture <url | -> --ns <name> [--title "…"] [--author "…"] [--note "…"]   (- reads the text from stdin)
  bun run cli job <job_id>
  bun run cli items --ns <name> [--status ready|failed|queued|running]
  bun run cli doc <item_id> [--out file.json]

Runs the pipeline in-process (no server needed). Config comes from .env / environment (see .env.example).`;

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    ns: { type: "string" },
    org: { type: "string" },
    description: { type: "string", default: "" },
    "language-learning": { type: "boolean", default: false },
    diarize: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    title: { type: "string" },
    author: { type: "string" },
    note: { type: "string" },
    stages: { type: "string" },
    status: { type: "string" },
    out: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [cmd, sub, ...rest] = positionals;
if (values.help || !cmd) {
  console.log(HELP);
  process.exit(0);
}

const config = loadConfig();
const handle = await createDb({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR, ssl: config.DATABASE_URL ? databaseSsl(config.DATABASE_URL, { mode: config.DATABASE_SSL, caPath: config.DATABASE_SSL_CA }) : undefined });
const db = handle.db;
const storage = createStorage(config);

function needNs(): string {
  if (!values.ns) throw new Error("--ns <namespace> is required");
  return values.ns;
}
// Workspace scope: --org <slug> (multi-tenant); without it, only namespaces with a unique name / no workspace resolve.
const organizationId = values.org ? (await getOrganization(db, values.org))?.id : undefined;
if (values.org && !organizationId) throw new Error(`workspace "${values.org}" not found`);

const route = cmd === "ns" ? `ns ${sub ?? ""}`.trim() : cmd;

try {
  switch (route) {
    case "ns create": {
      const name = rest[0];
      if (!name) throw new Error("ns create <name>");
      const ns = await createNamespace(db, { organizationId, name, description: values.description, flags: { language_learning: values["language-learning"], ...(values.diarize ? { diarize: true } : {}) } });
      console.log(`created namespace ${ns.name} (${ns.id})`);
      break;
    }
    case "ns list": {
      const rows = await listNamespaces(db, organizationId);
      if (!rows.length) console.log("(no namespaces)");
      for (const r of rows) console.log(`${r.name.padEnd(24)} ${String(r.readyCount).padStart(3)}/${String(r.itemCount).padEnd(3)} ready  ${r.id}  ${r.description}`);
      break;
    }
    case "job": {
      const id = sub;
      const s = await getJobStatus(db, id!);
      if (!s) throw new Error(`job ${id} not found`);
      console.log(`${s.item.title || s.item.sourceUrl}\n  item ${s.item.id} · ${s.item.status} · job ${s.job.id} v${s.job.version} · ${s.job.state} · $${s.job.costUsd.toFixed(4)}`);
      for (const p of s.progress) console.log(`  ${p.stage.padEnd(11)} ${p.state.padEnd(8)} ${p.cost_usd ? `$${p.cost_usd.toFixed(4)}` : ""}${p.reason ? `  (${p.reason})` : ""}${p.error ? `  ERROR: ${p.error}` : ""}`);
      break;
    }
    case "items": {
      const ns = await getNamespace(db, needNs(), organizationId);
      if (!ns) throw new Error(`namespace ${values.ns} not found`);
      const rows = await listItems(db, ns.id, values.status);
      if (!rows.length) console.log("(no items)");
      for (const r of rows) console.log(`${r.id}  ${r.status.padEnd(8)} ${(r.title || r.sourceUrl).slice(0, 70)}`);
      break;
    }
    case "doc": {
      const item = await getItem(db, sub!);
      if (!item) throw new Error(`item ${sub} not found`);
      const doc = await loadDocument(storage, item.id);
      if (!doc) throw new Error(`no document yet for ${item.id}`);
      const json = JSON.stringify(doc, null, 2);
      if (values.out) {
        await writeFile(values.out, json);
        console.log(`wrote ${values.out}`);
      } else console.log(json);
      break;
    }
    case "capture": {
      // `capture <url>` fetches the page; `capture -` reads pasted text from stdin (optionally with --title/--author).
      const arg = sub;
      if (!arg) throw new Error("capture <url | -> --ns <namespace>");
      const text = arg === "-" ? (await Bun.stdin.text()).trim() : undefined;
      const providers = createProviders(config);
      const res = await createCapture({ db, storage, fetchPage: providers.fetchPage }, { namespace: needNs(), organizationId, url: arg === "-" ? undefined : arg, text, title: values.title, author: values.author, note: values.note, force: values.force });
      console.log(`${res.reused ? "resuming" : "created"} ${res.item.sourceType} ${res.item.id} — ${res.item.title}`);
      if (res.linked_videos.length) console.log(`linked videos: ${res.linked_videos.join(", ")}${res.queued_videos.length ? " (queued)" : " (namespace flag auto_ingest_links is off — ingest them by hand)"}`);
      if (res.reused && res.job.state === "done") {
        console.log("item is already ready — use --force to re-run");
        break;
      }
      const t0 = Date.now();
      const job = await runJob({ db, storage, config, providers, log: (m) => console.log(m) }, res.job.id);
      console.log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(0)}s — job ${job.id} · $${job.costUsd.toFixed(4)}`);
      break;
    }
    default: {
      if (cmd !== "ingest") throw new Error(`unknown command "${cmd}"\n\n${HELP}`);
      const url = sub;
      if (!url) throw new Error("ingest <url> --ns <namespace>");
      const stages = values.stages?.split(",").map((s) => s.trim()).filter(Boolean) as StageName[] | undefined;
      for (const s of stages ?? []) if (!STAGE_NAMES.includes(s)) throw new Error(`unknown stage "${s}" (valid: ${STAGE_NAMES.join(", ")})`);
      const res = await createIngest(db, { namespace: needNs(), organizationId, url, force: values.force });
      console.log(`${res.reused ? "resuming" : "created"} job ${res.job.id} for item ${res.item.id}`);
      if (res.reused && res.job.state === "done" && !stages) {
        console.log("item is already ready — use --force to re-ingest or --stages to re-run specific stages");
        break;
      }
      const t0 = Date.now();
      const job = await runJob({ db, storage, config, providers: createProviders(config), log: (m) => console.log(m) }, res.job.id, { stages });
      console.log(`\nDONE in ${((Date.now() - t0) / 1000).toFixed(0)}s — job ${job.id} · $${job.costUsd.toFixed(4)}`);
      const s = await getJobStatus(db, job.id);
      for (const p of s?.progress ?? []) console.log(`  ${p.stage.padEnd(11)} ${p.state.padEnd(8)} ${p.cost_usd ? `$${p.cost_usd.toFixed(4)}` : ""}${p.reason ? `  (${p.reason})` : ""}`);
    }
  }
} catch (err) {
  console.error(`error: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await handle.close();
}
