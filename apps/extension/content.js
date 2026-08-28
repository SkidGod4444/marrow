// In-page controls: a "Save to Marrow" button inside the YouTube player's control bar and in each X / LinkedIn post's
// action row. Left-click saves to the last namespace used; right-click picks a namespace. Everything talks to the
// background worker, which holds the key and does the API calls. Sites re-render constantly, so a MutationObserver
// re-injects; SPA navigations on YouTube are caught via yt-navigate-finish. No innerHTML anywhere: YouTube enforces
// Trusted Types, so everything is built as nodes.
(() => {
  if (window.__marrowInjected) return;
  window.__marrowInjected = true;
  const ICON = chrome.runtime.getURL("icons/48.png");
  const host = location.hostname.replace(/^www\./, "");
  const site = /(^|\.)youtube\.com$/.test(host) ? "youtube" : /(^|\.)(x|twitter)\.com$/.test(host) ? "x" : /(^|\.)linkedin\.com$/.test(host) ? "linkedin" : null;
  if (!site) return;
  const send = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, resolve));
  const el = (tag, props = {}, children = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.style.cssText = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (const c of children) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    return n;
  };
  const icon = (size) => el("img", { src: ICON, alt: "", width: String(size), height: String(size) });

  // ---- a toast and a namespace menu, in a shadow root so the sites' CSS stays out ----
  const shell = el("div", { style: "position:fixed;z-index:2147483646;inset:auto 16px 16px auto;pointer-events:none;" });
  const root = shell.attachShadow({ mode: "open" });
  root.appendChild(el("style", { text: `
    :host { all: initial; }
    .toast { pointer-events: auto; display: flex; align-items: center; gap: 10px; max-width: 360px; padding: 10px 14px; border-radius: 12px; border: 1px solid #2D2D2D; background: #151515; color: #ececea; font: 13px/1.4 system-ui, -apple-system, sans-serif; box-shadow: 0 8px 30px rgba(0,0,0,.45); animation: in .18s ease-out; }
    .toast img { width: 18px; height: 18px; border-radius: 5px; }
    .toast b { font-weight: 600; }
    .toast a { color: #ececea; text-decoration: underline; text-underline-offset: 3px; text-decoration-color: #4a4a4a; white-space: nowrap; margin-left: 4px; }
    .toast a:hover { text-decoration-color: #ececea; }
    .toast.bad { border-color: #7a2f2f; }
    .menu { pointer-events: auto; position: fixed; width: 280px; padding: 10px 12px 12px; border-radius: 12px; border: 1px solid #2D2D2D; background: #151515; color: #ececea; box-shadow: 0 8px 30px rgba(0,0,0,.45); font: 13px system-ui, sans-serif; animation: in .18s ease-out; }
    .menu p { margin: 0 0 8px; font: 10px ui-monospace, Menlo, monospace; letter-spacing: .14em; text-transform: uppercase; color: #9a9a96; }
    .menu .row { display: flex; gap: 8px; align-items: center; }
    .menu .select { flex: 1; min-width: 0; height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid #2D2D2D; background: #20201F; color: #ececea; font: 12.5px ui-monospace, Menlo, monospace; box-shadow: inset 0 1px 0 rgba(0,0,0,.4); }
    .menu .key { cursor: pointer; flex: none; height: 30px; padding: 0 14px; border-radius: 8px; border: 1px solid #9a9a96; border-bottom-width: 3px; background: linear-gradient(180deg, #f4f4f2, #dcdcda); color: #111; font: 500 12.5px system-ui, sans-serif; }
    .menu .key:active { transform: translateY(2px); border-bottom-width: 1px; }
    .menu .err { font-size: 12px; color: #9a9a96; }
    @keyframes in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
  ` }));
  document.documentElement.appendChild(shell);
  let toastTimer = 0;
  function toast(parts, bad = false, ms = 4500) {
    root.querySelector(".toast")?.remove();
    const t = el("div", { class: `toast${bad ? " bad" : ""}` }, [icon(18), el("span", {}, parts)]);
    root.appendChild(t);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.remove(), ms);
  }
  function closeMenu() { root.querySelector(".menu")?.remove(); }
  /** "Save to [namespace ▾] [Save]" — a small popover next to the button. */
  async function menu(x, y, onPick) {
    closeMenu();
    const r = await send({ type: "namespaces" });
    const m = el("div", { class: "menu", style: `left:${Math.max(8, Math.min(x - 140, innerWidth - 296))}px;top:${y}px` });
    m.addEventListener("click", (e) => e.stopPropagation());
    m.appendChild(el("p", { text: "save to" }));
    if (!r?.ok) m.appendChild(el("div", { class: "err", text: r?.error || "not connected" }));
    else if (!r.namespaces.length) m.appendChild(el("div", { class: "err", text: "no namespaces yet — create one in Marrow" }));
    else {
      const sel = el("select", { class: "select", "aria-label": "Namespace" }, r.namespaces.map((n) => el("option", { value: n.name, text: n.name, ...(n.name === r.current ? { selected: "" } : {}) })));
      const go = el("button", { class: "key", text: "Save", onclick: () => { closeMenu(); onPick(sel.value); } });
      m.appendChild(el("div", { class: "row" }, [sel, go]));
    }
    root.appendChild(m);
    m.style.top = `${Math.max(8, y - m.offsetHeight - 14)}px`; // above the control it came from
    setTimeout(() => document.addEventListener("click", closeMenu, { once: true }), 0);
  }

  // ---- saving ----
  async function save(payload, btn, namespace) {
    btn.classList.add("marrow-busy");
    const r = await send({ type: "save", ...payload, namespace });
    btn.classList.remove("marrow-busy");
    if (!r?.ok) {
      if (r?.setup) toast(["Paste an API key in the Marrow extension first — click its icon in the toolbar."], true, 7000);
      else toast([r?.error || "Couldn't save that"], true, 6000);
      return;
    }
    btn.classList.add("marrow-saved");
    const parts = [r.reused ? "Already in " : "Saved to ", el("b", { text: r.namespace })];
    if (r.link) parts.push(el("a", { href: r.link, target: "_blank", rel: "noreferrer", text: "Open in Marrow" }));
    toast(parts);
  }
  function wire(btn, getPayload) {
    btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); save(getPayload(), btn); });
    btn.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); menu(e.clientX, e.clientY, (ns) => save(getPayload(), btn, ns)); });
  }
  const TITLE = "Save to Marrow (right-click to pick a namespace)";

  // ---- YouTube: inside the player's right controls ----
  function injectYouTube() {
    if (!location.pathname.startsWith("/watch")) return;
    const controls = document.querySelector(".ytp-right-controls");
    if (!controls || controls.querySelector(".marrow-save")) return;
    const btn = el("button", { class: "ytp-button marrow-save", title: TITLE, "aria-label": "Save to Marrow" }, [icon(24)]);
    controls.insertBefore(btn, controls.firstChild);
    wire(btn, () => ({ kind: "youtube", url: location.href, title: document.title.replace(/ - YouTube$/, "") }));
  }

  // ---- X: in each post's action row ----
  function injectX() {
    for (const art of document.querySelectorAll('article[data-testid="tweet"]')) {
      const bar = art.querySelector('[role="group"]');
      if (!bar || bar.querySelector(".marrow-save")) continue;
      const btn = el("button", { class: "marrow-save marrow-round", title: TITLE, "aria-label": "Save to Marrow" }, [icon(20)]);
      bar.appendChild(el("div", { class: "marrow-wrap" }, [btn]));
      wire(btn, () => {
        const link = art.querySelector('a[href*="/status/"] time')?.closest("a")?.href || location.href;
        const author = art.querySelector('[data-testid="User-Name"]')?.innerText?.split("\n")[0] || "";
        return { kind: "x", url: link, text: art.querySelector('[data-testid="tweetText"]')?.innerText || "", author, title: author ? `${author} on X` : document.title };
      });
    }
  }

  // ---- LinkedIn: in each post's action bar ----
  function injectLinkedIn() {
    for (const post of document.querySelectorAll(".feed-shared-update-v2, [data-urn^='urn:li:activity']")) {
      const bar = post.querySelector(".feed-shared-social-action-bar, .social-actions-bar, .feed-shared-social-actions");
      if (!bar || bar.querySelector(".marrow-save")) continue;
      const btn = el("button", { class: "marrow-save marrow-li", title: TITLE, "aria-label": "Save to Marrow" }, [icon(20), el("span", { text: "Marrow" })]);
      bar.appendChild(btn);
      wire(btn, () => {
        const urn = post.getAttribute("data-urn") || post.querySelector("[data-urn]")?.getAttribute("data-urn") || "";
        const link = urn ? `https://www.linkedin.com/feed/update/${urn}/` : location.href;
        const author = post.querySelector(".update-components-actor__title, .update-components-actor__name")?.innerText?.trim().split("\n")[0] || "";
        return { kind: "linkedin", url: link, text: post.querySelector(".update-components-text, .feed-shared-update-v2__description")?.innerText || "", author, title: author ? `${author} on LinkedIn` : document.title };
      });
    }
  }

  const inject = { youtube: injectYouTube, x: injectX, linkedin: injectLinkedIn }[site];
  let pending = 0;
  const schedule = () => { if (pending) return; pending = setTimeout(() => { pending = 0; inject(); }, 250); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener("yt-navigate-finish", schedule);
  schedule();
})();
