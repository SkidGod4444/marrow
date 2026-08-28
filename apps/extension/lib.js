// Shared by the popup and the background worker: settings, the Marrow API, the cookie export, what the current tab is.

export const DEFAULTS = { apiUrl: "", apiKey: "", org: "", webUrl: "", auto: true, lastNamespace: "" };

export async function getSettings() {
  const s = await chrome.storage.local.get(DEFAULTS);
  return { ...DEFAULTS, ...s, apiUrl: (s.apiUrl || "").replace(/\/$/, ""), webUrl: (s.webUrl || "").replace(/\/$/, "") };
}
export const getState = () => chrome.storage.local.get({ lastPush: null, lastResult: null, lastError: null, lastCheck: null });
export const setState = (patch) => chrome.storage.local.set(patch);

// ---- the API ----
export async function api(settings, path, init = {}) {
  if (!settings.apiUrl || !settings.apiKey) throw new Error("set the server address and API key in Options first");
  const headers = { "x-api-key": settings.apiKey, ...(settings.org ? { "x-marrow-org": settings.org } : {}), ...(init.headers || {}) };
  const res = await fetch(`${settings.apiUrl}${path}`, { ...init, headers, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `the server answered ${res.status}`);
  return body;
}
export const listNamespaces = (s) => api(s, "/namespaces").then((b) => b.namespaces || []);
export const ingestVideo = (s, namespace, url) => api(s, "/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ namespace, url }) });
export const capturePost = (s, body) => api(s, "/capture", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function readHealth(settings) {
  if (!settings.apiUrl) throw new Error("set the server address in Options first");
  const res = await fetch(`${settings.apiUrl}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`the server answered ${res.status}`);
  return res.json();
}

/** Does the server need a fresh jar? */
export function needsCookies(health) {
  const yt = health?.youtube;
  const keeper = health?.youtube_session?.status;
  return yt === "cookies_stale" || yt === "blocked" || yt === "unconfigured" || keeper === "signed_out" || keeper === "needs_seed";
}

// ---- cookies ----
const DOMAINS = ["youtube.com", "google.com", "googlevideo.com"];

/** yt-dlp needs the Google/YouTube cookies; the rest of the profile stays here. */
export async function exportJar() {
  const seen = new Map();
  for (const domain of DOMAINS) for (const c of await chrome.cookies.getAll({ domain })) seen.set(`${c.domain}|${c.path}|${c.name}`, c);
  const cookies = [...seen.values()];
  const lines = ["# Netscape HTTP Cookie File", `# Exported by the Marrow extension on ${new Date().toISOString()}`, ""];
  for (const c of cookies) {
    const domain = c.domain.startsWith(".") ? c.domain : c.hostOnly ? c.domain : `.${c.domain}`;
    const expires = c.session || !c.expirationDate ? 0 : Math.floor(c.expirationDate);
    lines.push([`${c.httpOnly ? "#HttpOnly_" : ""}${domain}`, domain.startsWith(".") ? "TRUE" : "FALSE", c.path || "/", c.secure ? "TRUE" : "FALSE", String(expires), c.name, c.value].join("\t"));
  }
  const names = new Set(cookies.map((c) => c.name));
  const signedIn = ["SID", "HSID", "SSID", "APISID", "SAPISID"].every((n) => names.has(n));
  return { text: `${lines.join("\n")}\n`, count: cookies.length, signedIn };
}

export async function sendCookies(settings) {
  const jar = await exportJar();
  if (!jar.signedIn) throw new Error("this browser profile is not signed in to YouTube — sign in here first (with the spare account)");
  const body = await api(settings, "/youtube/cookies", { method: "POST", headers: { "content-type": "text/plain" }, body: jar.text });
  await setState({ lastPush: Date.now(), lastResult: `sent ${body.cookies} cookies`, lastError: null });
  return body;
}

// ---- what is this tab? ----
export function classify(url) {
  let u;
  try { u = new URL(url || ""); } catch { return { kind: "none" }; }
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  if ((host === "youtube.com" && u.pathname === "/watch" && u.searchParams.get("v")) || host === "youtu.be") {
    const id = host === "youtu.be" ? u.pathname.slice(1).split("/")[0] : u.searchParams.get("v");
    return { kind: "youtube", url: `https://www.youtube.com/watch?v=${id}` };
  }
  if ((host === "x.com" || host === "twitter.com") && /^\/[^/]+\/status\/\d+/.test(u.pathname)) return { kind: "x", url: `https://x.com${u.pathname.split("/").slice(0, 4).join("/")}` };
  if (host === "linkedin.com" && /^\/(posts|feed\/update|pulse)\//.test(u.pathname)) return { kind: "linkedin", url: u.origin + u.pathname };
  return { kind: "none" };
}
