import { getSettings } from "./lib.js";

const $ = (id) => document.getElementById(id);
getSettings().then((s) => { $("apiUrl").value = s.apiUrl; $("apiKey").value = s.apiKey; $("org").value = s.org; $("webUrl").value = s.webUrl; $("auto").checked = s.auto; });

$("save").addEventListener("click", async () => {
  const apiUrl = $("apiUrl").value.trim().replace(/\/$/, "");
  const apiKey = $("apiKey").value.trim();
  const org = $("org").value.trim();
  const webUrl = $("webUrl").value.trim().replace(/\/$/, "");
  const auto = $("auto").checked;
  let origin;
  try { origin = `${new URL(apiUrl).origin}/*`; } catch { $("msg").textContent = "that API address doesn't look right"; return; }
  // the server is whatever you run: ask for that one origin, nothing broader
  const granted = await chrome.permissions.request({ origins: [origin] }).catch(() => false);
  if (!granted) { $("msg").textContent = "Chrome needs permission to reach that address"; return; }
  await chrome.storage.local.set({ apiUrl, apiKey, org, webUrl, auto });
  $("msg").textContent = "Saved";
});
