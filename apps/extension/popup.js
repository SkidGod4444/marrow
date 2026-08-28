import { capturePost, classify, exportJar, getSettings, getState, ingestVideo, listNamespaces, needsCookies, sendCookies } from "./lib.js";

const $ = (id) => document.getElementById(id);
const ago = (t) => (t ? `${Math.max(1, Math.round((Date.now() - t) / 60000))} min ago` : "never");
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

let settings, tab, page, post = null, health = null;

async function loadNamespaces() {
  const sel = $("namespace");
  sel.innerHTML = "";
  try {
    const list = await listNamespaces(settings);
    if (!list.length) { sel.innerHTML = '<option value="">no namespaces yet</option>'; return; }
    for (const n of list) {
      const o = document.createElement("option");
      o.value = n.name; o.textContent = n.name; if (n.name === settings.lastNamespace) o.selected = true;
      sel.appendChild(o);
    }
  } catch (err) {
    sel.innerHTML = `<option value="">${err.message}</option>`;
  }
}

async function showTab() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  page = classify(tab?.url);
  const kindLabel = { youtube: "YouTube video", x: "Post on X", linkedin: "LinkedIn post", none: "This tab" }[page.kind];
  $("kind").textContent = kindLabel;
  if (page.kind === "none") {
    $("title").textContent = "Open a YouTube video, an X post or a LinkedIn post to add it here.";
    $("go").disabled = true; $("namespace").disabled = true;
    return;
  }
  $("title").textContent = (tab.title || page.url).replace(/ - YouTube$/, "").replace(/ \/ X$/, "");
  $("go").textContent = page.kind === "youtube" ? "Add video" : "Capture post";
  if (page.kind !== "youtube") {
    const r = await send({ type: "read-post", tabId: tab.id });
    post = r?.ok ? r.post : null;
    if (post?.text) { $("preview").textContent = post.text.length > 220 ? `${post.text.slice(0, 218)}…` : post.text; if (post.title) $("title").textContent = post.title; }
    else $("preview").textContent = "Couldn't read the post's text on this page — Marrow needs it for social links. Select the text and try again.";
  }
}

async function showCookies() {
  const state = await getState();
  const jar = await exportJar();
  $("profile").textContent = jar.signedIn ? `signed in · ${jar.count} cookies` : `not signed in to YouTube`;
  $("profile").className = jar.signedIn ? "ok" : "bad";
  $("last").textContent = state.lastPush ? `${ago(state.lastPush)} · ${state.lastResult}` : "never";
  const r = await send({ type: "health" });
  if (!r?.ok) { $("youtube").textContent = r?.error || "unreachable"; $("youtube").className = "bad"; return; }
  health = r.health;
  $("youtube").textContent = health.youtube ?? "unknown";
  $("youtube").className = health.youtube === "ok" ? "ok" : health.youtube === "unknown" ? "" : "bad";
  const k = health.youtube_session;
  $("keeper").textContent = k ? `${k.status}${k.cookies ? ` · ${k.cookies} cookies` : ""}` : "not running";
  $("keeper").className = k?.status === "ok" ? "ok" : k ? "bad" : "";
  $("note").textContent = needsCookies(health) ? "stale — send now" : state.lastError ? `last problem: ${state.lastError}` : "";
}

$("go").addEventListener("click", async () => {
  const namespace = $("namespace").value;
  if (!namespace) { $("addNote").textContent = "Pick a namespace (create one in Marrow first)."; return; }
  $("go").disabled = true; $("addNote").textContent = "Adding…";
  try {
    await chrome.storage.local.set({ lastNamespace: namespace });
    let res;
    if (page.kind === "youtube") {
      // a stale server session would fail this ingest: send this profile's cookies first
      if (health && needsCookies(health)) { $("addNote").textContent = "Sending cookies first…"; await sendCookies(settings); }
      res = await ingestVideo(settings, namespace, page.url);
    } else {
      if (!post?.text) throw new Error("no post text to capture");
      res = await capturePost(settings, { namespace, url: page.url, text: post.text, title: post.title, author: post.author || undefined });
    }
    const link = settings.webUrl && res.item_id ? ` <a href="${settings.webUrl}/items/${res.item_id}" target="_blank" rel="noreferrer">Open in Marrow</a>` : "";
    $("addNote").innerHTML = `${res.reused ? "Already in" : "Added to"} <b>${namespace}</b>${res.state ? ` · ${res.state}` : ""}.${link}`;
  } catch (err) {
    $("addNote").textContent = err.message || String(err);
  } finally {
    $("go").disabled = false;
  }
});

$("send").addEventListener("click", async () => {
  $("send").disabled = true; $("send").textContent = "Sending…";
  const r = await send({ type: "send-cookies" });
  $("send").disabled = false; $("send").textContent = "Send cookies now";
  $("note").textContent = r?.ok ? `sent ${r.result.cookies} cookies — the server is checking YouTube; the keeper picks the jar up within the hour` : r?.error || "failed";
  showCookies();
});
$("options").addEventListener("click", (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

(async () => {
  settings = await getSettings();
  if (!settings.apiUrl || !settings.apiKey) { $("title").textContent = "Set the server address and API key in Options."; $("go").disabled = true; return; }
  await Promise.all([showTab(), loadNamespaces(), showCookies()]);
})();
