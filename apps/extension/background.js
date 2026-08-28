import { capturePost, classify, getSettings, ingestVideo, listNamespaces, needsCookies, readHealth, saveSettings, sendCookies, setState } from "./lib.js";

// 1. Every hour, quietly: if the server says its YouTube session is stale, send this profile's cookies. Nothing is sent
//    while the server is fine — a healthy, server-rotated jar must not be overwritten with an older copy.
// 2. A badge on the icon whenever the tab is something Marrow can take: a YouTube video, an X post, a LinkedIn post.
const ALARM = "marrow-check";
const arm = () => chrome.alarms.create(ALARM, { periodInMinutes: 60 });
chrome.runtime.onInstalled.addListener(arm);
chrome.runtime.onStartup.addListener(arm);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM) return;
  const settings = await getSettings();
  if (!settings.apiKey) return;
  const role = settings.who?.role;
  if (role !== "owner" && role !== "instance") return; // only an owner's key may install cookies
  try {
    const health = await readHealth(settings);
    await setState({ lastCheck: Date.now() });
    if (needsCookies(health)) await sendCookies(settings);
  } catch (err) {
    await setState({ lastError: String(err.message || err) });
  }
});

const badge = async (tabId, url) => {
  const kind = classify(url).kind;
  await chrome.action.setBadgeText({ tabId, text: kind === "none" ? "" : "+" }).catch(() => undefined);
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#e06c6c" }).catch(() => undefined);
};
chrome.tabs.onUpdated.addListener((tabId, info, tab) => { if (info.status === "complete" || info.url) void badge(tabId, tab.url); });
chrome.tabs.onActivated.addListener(async ({ tabId }) => { const tab = await chrome.tabs.get(tabId).catch(() => null); if (tab) void badge(tabId, tab.url); });

/** Runs inside the page (X / LinkedIn): the post's text and author, nothing else. The user asked for this post, now. */
function readPost() {
  const og = (p) => document.querySelector(`meta[property="${p}"]`)?.getAttribute("content") || "";
  const host = location.hostname;
  if (/(^|\.)(x|twitter)\.com$/.test(host)) {
    const art = document.querySelector('article[data-testid="tweet"]');
    const text = art?.querySelector('[data-testid="tweetText"]')?.innerText || og("og:description") || "";
    const author = art?.querySelector('[data-testid="User-Name"]')?.innerText?.split("\n")[0] || "";
    return { text, author, title: author ? `${author} on X` : document.title };
  }
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const el = document.querySelector(".feed-shared-update-v2__description, .update-components-text, .article-content, .reader-article-content");
    const text = el?.innerText || og("og:description") || "";
    const author = document.querySelector(".update-components-actor__name, .update-components-actor__title, .reader-author-info__name")?.innerText?.trim().split("\n")[0] || "";
    return { text, author, title: author ? `${author} on LinkedIn` : document.title.replace(/ \| LinkedIn$/, "") };
  }
  return { text: window.getSelection()?.toString() || og("og:description") || "", author: "", title: document.title };
}

const isOwner = (s) => s.who?.role === "owner" || s.who?.role === "instance";

/** Save from an in-page button: pick the namespace, refresh a stale YouTube session quietly, ingest or capture. */
async function saveFromPage(settings, msg) {
  const namespaces = await listNamespaces(settings);
  if (!namespaces.length) throw new Error("create a namespace in Marrow first");
  const namespace = msg.namespace || (namespaces.some((n) => n.name === settings.lastNamespace) ? settings.lastNamespace : namespaces[0].name);
  await saveSettings({ lastNamespace: namespace });
  let res;
  if (msg.kind === "youtube") {
    const page = classify(msg.url);
    if (page.kind !== "youtube") throw new Error("that isn't a YouTube video page");
    if (isOwner(settings)) {
      const health = await readHealth(settings).catch(() => null);
      if (health && needsCookies(health)) await sendCookies(settings).catch(() => undefined);
    }
    res = await ingestVideo(settings, namespace, page.url);
  } else {
    if (!msg.text) throw new Error("couldn't read the post's text");
    res = await capturePost(settings, { namespace, url: msg.url, text: msg.text, title: msg.title, author: msg.author || undefined });
  }
  return { namespace, reused: Boolean(res.reused), item_id: res.item_id, link: res.item_id ? `${settings.webUrl}/items/${res.item_id}` : null };
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    try {
      const settings = await getSettings();
      if (msg?.type === "save") {
        if (!settings.apiKey) { chrome.action.openPopup?.().catch(() => undefined); return reply({ ok: false, setup: true }); }
        return reply({ ok: true, ...(await saveFromPage(settings, msg)) });
      }
      if (msg?.type === "namespaces") {
        if (!settings.apiKey) return reply({ ok: false, error: "not connected — click the Marrow icon" });
        return reply({ ok: true, namespaces: await listNamespaces(settings), current: settings.lastNamespace });
      }
      if (msg?.type === "send-cookies") return reply({ ok: true, result: await sendCookies(settings) });
      if (msg?.type === "health") return reply({ ok: true, health: await readHealth(settings) });
      if (msg?.type === "read-post") {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: msg.tabId }, func: readPost });
        return reply({ ok: true, post: r?.result || {} });
      }
      reply({ ok: false, error: "unknown request" });
    } catch (err) {
      await setState({ lastError: String(err.message || err) });
      reply({ ok: false, error: String(err.message || err) });
    }
  })();
  return true;
});
