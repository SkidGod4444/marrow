// The Netscape cookie-jar format yt-dlp reads (`--cookies`), as browsers export it: one cookie per line,
// domain · include-subdomains · path · secure · expires (unix seconds, 0 = session) · name · value, tab-separated;
// httpOnly cookies carry the "#HttpOnly_" prefix on the domain (curl/yt-dlp convention).

export type Cookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** unix seconds; -1 for a session cookie */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

export function parseNetscape(text: string): Cookie[] {
  const out: Cookie[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (line.startsWith("#")) continue;
    const f = line.split("\t");
    if (f.length < 7) continue;
    const [domain, , path, secure, expires, name, ...rest] = f;
    const exp = Number(expires);
    out.push({ name: name!, value: rest.join("\t"), domain: domain!, path: path || "/", expires: exp > 0 ? exp : -1, httpOnly, secure: secure === "TRUE" });
  }
  return out;
}

export function toNetscape(cookies: Cookie[]): string {
  const lines = ["# Netscape HTTP Cookie File", "# Written by the Marrow cookie keeper — yt-dlp reads this; do not edit by hand.", ""];
  for (const c of cookies) {
    const domain = `${c.httpOnly ? "#HttpOnly_" : ""}${c.domain}`;
    const sub = c.domain.startsWith(".") ? "TRUE" : "FALSE";
    const expires = c.expires > 0 ? String(Math.floor(c.expires)) : "0";
    lines.push([domain, sub, c.path || "/", c.secure ? "TRUE" : "FALSE", expires, c.name, c.value].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

/** Only what YouTube needs: its own cookies and the Google account ones. */
export const isYoutubeCookie = (domain: string) => /(^|\.)(youtube\.com|google\.com|googlevideo\.com)$/i.test(domain.replace(/^#HttpOnly_/, ""));
