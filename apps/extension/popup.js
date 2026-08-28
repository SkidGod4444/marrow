import { capturePost, classify, getSettings, ingestVideo, listNamespaces, needsCookies, saveSettings, sendCookies, whoAmI } from "./lib.js";
import { DEFAULT_API_URL, DEFAULT_WEB_URL } from "./config.js";

const $ = (id) => document.getElementById(id);
const show = (id) => { for (const v of document.querySelectorAll(".view")) v.hidden = v.id !== id; $("gear").hidden = id !== "main"; };
const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));

let settings, page, tab, post = null;

// ---- connect ----
async function connect(key) {
  const trial = { ...settings, apiKey: key.trim() };
  const me = await whoAmI(trial);
  const who = { name: me.user?.name || me.user?.email || "you", workspace: me.active?.name || null, role: me.active?.role || me.user?.via || null };
  await saveSettings({ apiKey: trial.apiKey, who });
  settings = await getSettings();
  return who;
}
async function tryPermission() {
  // the default address is in the manifest; a custom one needs Chrome's say-so once
  try { return await chrome.permissions.request({ origins: [`${new URL(settings.apiUrl).origin}/*`] }); } catch { return true; }
}
$("connect").addEventListener("click", async () => {
  $("connect").disabled = true; $("setupNote").textContent = "Checking…";
  try {
    await connect($("key").value);
    $("setupNote").textContent = "";
    await main();
  } catch (err) {
    $("setupNote").textContent = err.message;
  } finally {
    $("connect").disabled = false;
  }
});
$("key").addEventListener("keydown", (e) => { if (e.key === "Enter") $("connect").click(); });
$("openKeys").addEventListener("click", (e) => { e.preventDefault(); chrome.tabs.create({ url: `${settings.webUrl}/settings` }); });

// ---- main ----
function whoLine() {
  const w = settings.who;
  $("who").textContent = w ? [w.workspace, w.name].filter(Boolean).join(" · ") : "";
}

async function loadNamespaces() {
  const sel = $("namespace");
  sel.innerHTML = '<option value="">loading…</option>';
  try {
    const list = await listNamespaces(settings);
    sel.innerHTML = "";
    if (!list.length) { sel.innerHTML = '<option value="">no namespaces yet</option>'; $("go").disabled = true; $("addNote").innerHTML = `Create a namespace in Marrow first. <a href="${settings.webUrl}/library" target="_blank" rel="noreferrer">Open the library ↗</a>`; return; }
    for (const n of list) {
      const o = document.createElement("option");
      o.value = n.name; o.textContent = n.name; if (n.name === settings.lastNamespace) o.selected = true;
      sel.appendChild(o);
    }
  } catch (err) {
    sel.innerHTML = '<option value="">—</option>'; $("addNote").textContent = err.message;
    if (/API key/.test(err.message)) show("setup");
  }
}

async function showTab() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  page = classify(tab?.url);
  $("kind").textContent = { youtube: "( youtube video )", x: "( post on x )", linkedin: "( linkedin post )", none: "( this tab )" }[page.kind];
  $("preview").hidden = true;
  if (page.kind === "none") {
    $("title").textContent = "Open a YouTube video, an X post or a LinkedIn post and it shows up here.";
    $("title").classList.add("muted");
    $("addRow").hidden = true;
    return;
  }
  $("title").classList.remove("muted"); $("addRow").hidden = false;
  $("title").textContent = (tab.title || page.url).replace(/ - YouTube$/, "").replace(/ \/ X$/, "").replace(/ \| LinkedIn$/, "");
  $("go").textContent = page.kind === "youtube" ? "Add video" : "Capture post";
  if (page.kind !== "youtube") {
    const r = await send({ type: "read-post", tabId: tab.id });
    post = r?.ok ? r.post : null;
    if (post?.text) {
      $("preview").textContent = post.text.length > 200 ? `${post.text.slice(0, 198)}…` : post.text; $("preview").hidden = false;
      if (post.title) $("title").textContent = post.title;
    } else {
      $("preview").textContent = "Couldn't read the post's text here. Select it on the page and try again."; $("preview").hidden = false;
    }
  }
}

let health = null;
/** Read quietly; the user never sees this. */
async function readHealthQuietly() {
  const r = await send({ type: "health" });
  health = r?.ok ? r.health : null;
}

$("go").addEventListener("click", async () => {
  const namespace = $("namespace").value;
  if (!namespace) return;
  $("go").disabled = true; $("addNote").textContent = "Adding…";
  try {
    await saveSettings({ lastNamespace: namespace });
    let res;
    if (page.kind === "youtube") {
      // a stale server session would fail this ingest: refresh it from this profile first, silently
      if (health && needsCookies(health) && canSendCookies()) await sendCookies(settings).catch(() => undefined);
      res = await ingestVideo(settings, namespace, page.url);
    } else {
      if (!post?.text) throw new Error("there's no post text to capture");
      res = await capturePost(settings, { namespace, url: page.url, text: post.text, title: post.title, author: post.author || undefined });
    }
    const open = res.item_id ? ` <a href="${settings.webUrl}/items/${res.item_id}" target="_blank" rel="noreferrer">Open in Marrow ↗</a>` : "";
    $("addNote").innerHTML = `${res.reused ? "Already in" : "Added to"} <b>${namespace}</b>.${open}`;
  } catch (err) {
    $("addNote").textContent = err.message || String(err);
  } finally {
    $("go").disabled = false;
  }
});

// ---- settings ----
const canSendCookies = () => settings.who?.role === "owner" || settings.who?.role === "instance";
$("gear").addEventListener("click", () => {
  $("key2").value = settings.apiKey; $("apiUrl").value = settings.apiUrl; $("webUrl").value = settings.webUrl; $("settingsNote").textContent = ""; $("forceNote").textContent = "";
  $("force").hidden = !canSendCookies();
  show("settings");
});
$("force").addEventListener("click", async () => {
  $("force").disabled = true; $("forceNote").textContent = "Sending…";
  try {
    const r = await sendCookies(settings);
    $("forceNote").textContent = `Sent ${r.cookies} cookies.`;
  } catch (err) {
    $("forceNote").textContent = err.message;
  } finally {
    $("force").disabled = false;
  }
});
$("back").addEventListener("click", () => show("main"));
$("reset").addEventListener("click", () => { $("apiUrl").value = DEFAULT_API_URL; $("webUrl").value = DEFAULT_WEB_URL; });
$("save").addEventListener("click", async () => {
  $("save").disabled = true;
  try {
    await saveSettings({ apiUrl: $("apiUrl").value.trim().replace(/\/$/, "") || DEFAULT_API_URL, webUrl: $("webUrl").value.trim().replace(/\/$/, "") || DEFAULT_WEB_URL });
    settings = await getSettings();
    if (settings.apiUrl !== DEFAULT_API_URL && !(await tryPermission())) throw new Error("Chrome needs permission to reach that address");
    if ($("key2").value.trim() !== settings.apiKey) await connect($("key2").value);
    await main();
  } catch (err) {
    $("settingsNote").textContent = err.message;
  } finally {
    $("save").disabled = false;
  }
});

async function main() {
  settings = await getSettings();
  if (!settings.apiKey) { show("setup"); return; }
  whoLine();
  show("main");
  await Promise.all([showTab(), loadNamespaces(), readHealthQuietly()]);
}
main();
