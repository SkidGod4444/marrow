import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// Installing a YouTube cookie jar sent by the owner's browser (the Chrome extension in apps/extension, or any client
// that posts a Netscape cookies.txt). The jar is validated — it must be a signed-in YouTube session — filtered to
// the Google/YouTube domains yt-dlp needs, and written atomically to the configured path. The cookie keeper treats a
// jar it did not write as a seed and imports it on its next tick; yt-dlp picks it up on its next run.

export type JarCookie = { domain: string; includeSubdomains: boolean; path: string; secure: boolean; expires: number; name: string; value: string; httpOnly: boolean };

const YOUTUBE_DOMAIN = /(^|\.)(youtube\.com|google\.com|googlevideo\.com)$/i;
/** Cookies a signed-in session always carries; without them yt-dlp is as anonymous as with no jar at all. */
const SIGNED_IN = ["SID", "HSID", "SSID", "APISID", "SAPISID"];

export function parseNetscape(text: string): JarCookie[] {
  const out: JarCookie[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 7) continue;
    out.push({ domain: f[0]!, includeSubdomains: f[1]!.toUpperCase() === "TRUE", path: f[2]!, secure: f[3]!.toUpperCase() === "TRUE", expires: Number(f[4]) || 0, name: f[5]!, value: f.slice(6).join("\t"), httpOnly });
  }
  return out;
}

export function toNetscape(cookies: JarCookie[]): string {
  const lines = ["# Netscape HTTP Cookie File", "# Installed by Marrow from the owner's browser.", ""];
  for (const c of cookies) {
    lines.push([`${c.httpOnly ? "#HttpOnly_" : ""}${c.domain}`, c.includeSubdomains ? "TRUE" : "FALSE", c.path, c.secure ? "TRUE" : "FALSE", String(Math.floor(c.expires)), c.name, c.value].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

export type JarVerdict = { ok: true; cookies: JarCookie[] } | { ok: false; error: string };

/** A jar worth installing: YouTube/Google cookies of a signed-in session. Says in plain words what is wrong otherwise. */
export function inspectJar(text: string): JarVerdict {
  if (text.length > 512 * 1024) return { ok: false, error: "that is too large to be a cookie file" };
  const all = parseNetscape(text);
  if (!all.length) return { ok: false, error: "no cookies found — send a Netscape cookies.txt" };
  const cookies = all.filter((c) => YOUTUBE_DOMAIN.test(c.domain));
  if (!cookies.length) return { ok: false, error: "no YouTube or Google cookies in the file" };
  const names = new Set(cookies.map((c) => c.name));
  const missing = SIGNED_IN.filter((n) => !names.has(n));
  if (missing.length) return { ok: false, error: `not a signed-in YouTube session (missing ${missing.join(", ")}) — sign in to YouTube in that browser profile first` };
  const now = Date.now() / 1000;
  if (cookies.some((c) => SIGNED_IN.includes(c.name) && c.expires && c.expires < now)) return { ok: false, error: "the session cookies have expired — sign in again" };
  return { ok: true, cookies };
}

/** Validate and install the jar at `path` (atomic write). Returns how many cookies were kept. */
export async function installCookieJar(path: string | undefined, text: string): Promise<{ cookies: number; path: string }> {
  if (!path) throw new Error("this server has no cookie file configured (YTDLP_COOKIES)");
  const verdict = inspectJar(text);
  if (!verdict.ok) throw new Error(verdict.error);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, toNetscape(verdict.cookies), { mode: 0o600 });
  await rename(tmp, path);
  return { cookies: verdict.cookies.length, path };
}
