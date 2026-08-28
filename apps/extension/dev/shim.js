// A stand-in for chrome.* and fetch so popup.html renders in a normal tab: ?state=setup|video|post|none|stale|nokey
const q = new URLSearchParams(location.search); const state = q.get("state") || "video";
const store = state === "setup" ? {} : { apiKey: "mrw_demo", who: { name: "Saidev", workspace: "Saidev's lab", role: "owner" }, lastNamespace: "self-help", lastPush: Date.now() - 42 * 60000, lastResult: "31 cookies" };
const tabs = { video: { url: "https://www.youtube.com/watch?v=YMTJw1G3yOM", title: "How to think about hard problems — a 2-hour interview - YouTube" }, post: { url: "https://x.com/someone/status/1234567890", title: "Someone on X" }, none: { url: "https://example.com/", title: "Example" }, stale: { url: "https://www.youtube.com/watch?v=abc", title: "A talk - YouTube" }, setup: { url: "https://www.youtube.com/watch?v=abc", title: "A talk - YouTube" } };
const health = state === "stale" ? { youtube: "cookies_stale", youtube_session: { status: "signed_out" } } : { youtube: "ok", youtube_session: { status: "ok", cookies: 31 } };
globalThis.chrome = {
  storage: { local: { get: async (d) => ({ ...d, ...store }), set: async (p) => Object.assign(store, p) } },
  cookies: { getAll: async () => ["SID", "HSID", "SSID", "APISID", "SAPISID"].map((name) => ({ name, value: "x", domain: ".youtube.com", path: "/", secure: true, httpOnly: name !== "SID" })) },
  tabs: { query: async () => [{ id: 1, ...tabs[state] }], create: () => {} },
  permissions: { request: async () => true },
  runtime: { sendMessage: (msg, cb) => setTimeout(() => cb(msg.type === "health" ? { ok: true, health } : msg.type === "read-post" ? { ok: true, post: { text: "Most research advice is about tools. The real bottleneck is choosing the question — and being willing to sit with one long enough to find out it was the wrong one.", author: "Someone", title: "Someone on X" } } : { ok: true, result: { cookies: 31 } }), 120) },
};
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname;
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
  if (path === "/me") return init?.headers?.["x-api-key"] === "mrw_bad" ? json({ error: "unauthorized" }, 401) : json({ user: { name: "Saidev", email: "s@x" }, active: { name: "Saidev's lab", role: "owner" } });
  if (path === "/namespaces") return json({ namespaces: [{ name: "actuators" }, { name: "self-help" }, { name: "english" }] });
  if (path === "/health") return json(health);
  if (path === "/ingest") return json({ item_id: "vid_demo", reused: false, state: "queued" }, 202);
  if (path === "/capture") return json({ item_id: "cap_demo", reused: false, state: "queued" }, 202);
  if (path === "/youtube/cookies") return json({ ok: true, cookies: 31 });
  return json({ error: "nope" }, 404);
};
