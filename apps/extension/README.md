# Marrow — Chrome extension

A private extension for Marrow users. Install it, paste an API key, done.

**What it does.** A *Save to Marrow* button appears on the page itself — in the YouTube player's control bar, and in the
action row of every X and LinkedIn post. Click saves to the namespace you used last; right-click opens *Save to* with a namespace dropdown; a small toast
confirms with an *Open in Marrow* link. (The toolbar popup does the same for the current tab and shows a `+` badge.) Videos go to `POST /ingest`. Posts are read from the page you have open
(text + author — your own browser, your own session, one post at a click) and go to `POST /capture` with that text, which
is the only way social links enter Marrow: the server never fetches X or LinkedIn.

**What it does quietly (owners only).** Marrow's server needs a signed-in YouTube session or YouTube refuses its ingests as
a bot. When the key belongs to a workspace owner, the extension posts this Chrome profile's YouTube/Google cookies to
`POST /youtube/cookies` — hourly, only when `/health` reports the session stale, and just before adding a YouTube video
while it is stale. There is no visible affordance for this; *Settings → Advanced → Send YouTube session now* forces one.
For it to work, run the extension in a **dedicated Chrome profile signed in to a spare YouTube account** and never watch
YouTube in that profile: a session used in two places is rotated out from under the server. It never logs in for you.

## Install

1. `chrome://extensions` → *Developer mode* → *Load unpacked* → pick `apps/extension`.
2. Click the icon → paste an API key from Marrow's *Settings → API keys* → *Connect*. The API and web addresses are built in
   (`config.js`); *Settings → Advanced* can override them for another instance.

## Develop

No build step; plain ES modules. `content.js` builds every node by hand — YouTube enforces Trusted Types, so `innerHTML`
throws there; keep it that way. The toast and menu live in a shadow root so the sites' CSS stays out. `python3 -m http.server 8765` inside this folder and open
`http://localhost:8765/dev/preview.html?state=video|post|none|setup|stale` — `dev/shim.js` stands in for `chrome.*` and the API.
