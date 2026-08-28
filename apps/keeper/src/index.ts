import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { type Cookie, isYoutubeCookie, parseNetscape, toNetscape } from "./netscape.ts";

// The cookie keeper (docs/DEPLOY.md → "YouTube blocks the server"). YouTube lets a *signed-in* session through from a
// cloud address, but the exported session dies the moment the account is used anywhere else. So this sidecar owns the
// session: a headless Chromium with a persistent profile visits youtube.com every hour — Google rotates the cookies in
// that browser — and writes a fresh Netscape jar for yt-dlp. Seeding happens once, without automating any login: the
// owner exports cookies from a private window into the jar path; a jar the keeper did not write itself is imported.

const JAR = process.env.KEEPER_JAR ?? "/secrets/youtube-cookies.txt";
const STATUS = process.env.KEEPER_STATUS ?? "/secrets/keeper-status.json";
const PROFILE = process.env.KEEPER_PROFILE ?? "/data/profile";
const INTERVAL_MS = Math.max(5, Number(process.env.KEEPER_INTERVAL_MINUTES ?? 60)) * 60_000;
const ONCE = process.env.KEEPER_ONCE === "1";

type Status = "ok" | "signed_out" | "needs_seed" | "error";
type Report = { status: Status; checked_at: string; cookies: number; detail?: string; seeded?: boolean };

const log = (m: string) => console.log(`[keeper] ${new Date().toISOString().slice(11, 19)} ${m}`);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function readJar(): Promise<string | null> {
  try {
    return await readFile(JAR, "utf8");
  } catch {
    return null;
  }
}
async function writeAtomic(path: string, text: string) {
  await mkdir(path.slice(0, path.lastIndexOf("/")) || "/", { recursive: true });
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}

const toPlaywright = (c: Cookie) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite ?? ("Lax" as const) });

let lastWritten: string | null = null; // hash of the jar as the keeper last wrote it; anything else on disk is a seed

export async function tick(): Promise<Report> {
  const checked_at = new Date().toISOString();
  const onDisk = await readJar();
  const seed = onDisk && sha(onDisk) !== lastWritten ? parseNetscape(onDisk).filter((c) => isYoutubeCookie(c.domain)) : null;
  await mkdir(PROFILE, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--no-default-browser-check"],
  });
  try {
    if (seed?.length) {
      await ctx.clearCookies();
      await ctx.addCookies(seed.map(toPlaywright));
      log(`imported a seed jar with ${seed.length} cookies`);
    } else if (seed && !seed.length) {
      log("the jar on disk has no YouTube cookies — ignoring it");
    }
    const page = await ctx.newPage();
    await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);
    const signedIn = await page.evaluate(() => {
      const w = globalThis as unknown as { ytcfg?: { get?: (k: string) => unknown } };
      return Boolean(w.ytcfg?.get?.("LOGGED_IN"));
    });
    const where = page.url();
    await page.close();
    if (!signedIn) {
      const status: Status = seed || lastWritten ? "signed_out" : "needs_seed";
      log(`not signed in at ${where} → ${status}`);
      return { status, checked_at, cookies: 0, detail: `landed on ${where}`, seeded: Boolean(seed?.length) };
    }
    const cookies = (await ctx.cookies(["https://www.youtube.com", "https://accounts.google.com", "https://www.google.com"]))
      .filter((c) => isYoutubeCookie(c.domain))
      .map<Cookie>((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
    const text = toNetscape(cookies);
    await writeAtomic(JAR, text);
    lastWritten = sha(text);
    log(`signed in; wrote ${cookies.length} cookies to ${JAR}`);
    return { status: "ok", checked_at, cookies: cookies.length, seeded: Boolean(seed?.length) };
  } finally {
    await ctx.close();
  }
}

async function run() {
  log(`profile ${PROFILE}, jar ${JAR}, every ${INTERVAL_MS / 60_000} min`);
  for (;;) {
    let report: Report;
    try {
      report = await tick();
    } catch (err) {
      report = { status: "error", checked_at: new Date().toISOString(), cookies: 0, detail: (err as Error).message.slice(0, 300) };
      log(`error: ${report.detail}`);
    }
    await writeAtomic(STATUS, JSON.stringify(report)).catch((e) => log(`status write failed: ${(e as Error).message}`));
    if (ONCE) return report;
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

if (import.meta.main) await run();
