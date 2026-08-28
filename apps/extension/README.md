# Marrow — Chrome extension

A private extension for the owner's browser. Two jobs:

1. **Add what you're looking at.** On a YouTube video, an X post or a LinkedIn post the icon shows a `+` badge; the popup
   offers *Add video* / *Capture post* into a namespace of your choice. Videos go to `POST /ingest`; posts are read from
   the page you have open (text + author — your own browser, your own session, one post at a click) and go to
   `POST /capture` with that text, which is the only way social links enter Marrow (the server never fetches X or LinkedIn).
2. **Keep the server's YouTube session alive.** YouTube blocks cloud IPs unless yt-dlp has a signed-in session. The popup
   shows `/health`'s verdict and sends this profile's YouTube/Google cookies to `POST /youtube/cookies`; with *auto* on it
   checks hourly and sends only when the server reports a stale session. Adding a YouTube video while the session is stale
   sends the cookies first.

## Install

1. `chrome://extensions` → *Developer mode* → *Load unpacked* → pick `apps/extension`.
2. Open the extension's *Options*: API address (`https://api.…`), an API key — a personal `mrw_…` key from *Settings → API keys*
   (it carries your workspace; cookies need an owner's key) or the instance key plus a workspace slug — and, optionally,
   the web app address for *Open in Marrow* links. Saving asks Chrome for permission to reach that one address.
3. For the cookies job, use a **dedicated Chrome profile signed in to a spare YouTube account** and never watch YouTube in
   it: a session used in two places is rotated out from under the server. The extension never logs in for you.

No build step; plain ES modules. The keeper (`apps/keeper`) treats a jar the server installed as a seed and imports it on
its next hourly tick; the server re-probes YouTube right after an upload, so `/health.youtube` tells you within a minute.
