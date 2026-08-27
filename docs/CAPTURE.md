# Capturing text into Marrow (PRD §7)

Everything that isn't a video enters through **capture**: a web page, a paper, a pasted post, a newsletter, or a feed entry. The text is fetched or stored, turned into an article (summary, takeaways, sections), enriched (references, claims, entity index), split into searchable segments and triaged for novelty — the same document shape as a video, minus timestamps. Capture is idempotent: the same URL (or the same pasted text) in the same namespace is one item.

All examples use `API=https://<api-host>` and `KEY=<MARROW_API_KEY>`.

## 1. From anything: `POST /capture`

```bash
curl -X POST $API/capture -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"namespace":"robotics","url":"https://blog.example.com/why-sim-to-real-fails"}'
```

| Field | Meaning |
|---|---|
| `namespace` | required |
| `url` | fetched server-side (plain GET, no login, no automation). HTML → readable article (Readability) → markdown; PDF (and arXiv `abs` links, which resolve to the PDF) → text; a bare YouTube link is routed to video ingestion instead. |
| `text` | the content itself. Required for social posts (X, LinkedIn, Facebook, Instagram, Threads — the PRD forbids scraping them); optional otherwise (wins over the fetched page). |
| `title`, `author`, `note` | optional. `note` is why you saved it — shown on the item. |
| `source_type` | `captured_post` (default), `newsletter`, or `paper` (auto for arXiv/PDF/DOI-style links). |

Response `202` (`200` if it already existed): `{ job_id, item_id, reused, source_type, title, linked_videos, queued_videos }`. `linked_videos` are YouTube links found in the text. They are **offered** on the item page ("Ingest") unless the namespace has the flag `auto_ingest_links`, in which case they are queued immediately and listed in `queued_videos` (PRD §15 Q4 — default off).

MCP: the `capture` tool takes the same fields. CLI: `bun run cli capture <url> --ns robotics`, or `pbpaste | bun run cli capture - --ns robotics --title "…"`.

## 2. From your phone: share sheet

### iPhone / iPad — Shortcuts

1. Shortcuts → **+** → name it "Marrow" → **ⓘ** → enable **Show in Share Sheet**, accept **URLs, Text, Safari web pages**.
2. Actions, in order:
   1. **Get Variable** → *Shortcut Input* (rename the variable `Input`).
   2. **Get URLs from Input** → `URLs`.
   3. **Text** → paste the JSON below (the `Input`/`URLs` tokens are the variables):
      ```
      {"namespace":"robotics","url":"[URLs]","text":"[Input]"}
      ```
      For a post whose page can't be fetched (X, LinkedIn), the sharing app usually passes the post *text* as Input and the link as URLs — both are sent, and the text wins.
   4. **Get Contents of URL** → `https://<api-host>/capture`, Method **POST**, Headers `x-api-key: <key>` and `content-type: application/json`, Request Body **File** → the *Text* from step 3.
   5. **Get Dictionary Value** → `title` from *Contents of URL* → **Show Notification** "Captured: [title]".
3. Share anything → Marrow. It's searchable in the namespace in under a minute (the acceptance criterion for this phase).

Use one shortcut per namespace, or add a **Choose from Menu** step that sets the namespace.

### Android — HTTP Shortcuts (or Tasker)

Create a shortcut: `POST https://<api-host>/capture`, headers `x-api-key`, `content-type: application/json`, body `{"namespace":"robotics","url":"{{url}}","text":"{{text}}"}` with the share-target variables; enable "Show in share menu".

### Desktop — bookmarklet

```js
javascript:(async()=>{const r=await fetch("https://<api-host>/capture",{method:"POST",headers:{"x-api-key":"<key>","content-type":"application/json"},body:JSON.stringify({namespace:"robotics",url:location.href,text:window.getSelection().toString()||undefined})});const j=await r.json();alert(r.ok?"Captured: "+j.title:"Marrow: "+j.error)})()
```
Select text first to capture just that (and to capture social posts).

## 3. Newsletters: inbound email

`STACK:inbound_email` is provider-agnostic: the provider's inbound webhook posts each mail as JSON to

```
POST https://<api-host>/inbound/email/<INBOUND_EMAIL_TOKEN>
```

The endpoint understands **Postmark** inbound JSON, **CloudMailin** (JSON format), and a generic `{from, to, subject, text?, html?}`. Each mail becomes a `newsletter` item, keyed by its `Message-ID` (redeliveries are idempotent). Routing: the namespace is the **plus-tag of the recipient** — subscribe with `<address>+robotics@…` — or `INBOUND_EMAIL_NAMESPACE` when there is no tag; mails with neither are dropped (logged, answered 200 so the provider stops retrying).

Setup (no domain needed):

- **Postmark**: Servers → Inbound → copy the inbound address `<hash>@inbound.postmarkapp.com` → set *Inbound webhook URL* to the URL above. Subscribe newsletters with `<hash>+<namespace>@inbound.postmarkapp.com`.
- **CloudMailin**: create an address → target = the URL above, format **JSON (normalized)**.
- With your own domain, any of the above (or Amazon SES → SNS → a small forwarder) works the same way; the endpoint doesn't care who posts.

Env: `INBOUND_EMAIL_TOKEN` (long random string, e.g. `openssl rand -hex 24`), `INBOUND_EMAIL_NAMESPACE` (optional default). Rotate the token by changing the env and the webhook URL.

## 4. Feeds: podcasts and blogs

```bash
curl -X POST $API/sources -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"namespace":"robotics","url":"https://feeds.example.com/robot-talk.xml"}'
```
(or the "Follow a playlist, channel or feed" button in the Library, or the MCP `subscribe` tool). RSS 2.0 and Atom. Entries with an audio/video enclosure are ingested as `podcast_episode` through the full media pipeline (transcription, diarization, article…); entries without one are captured as text (the feed's full content when it carries it, else the page). Feeds are polled every `POLL_EVERY_MINUTES` with the playlists/channels; at most `FEED_MAX_PER_POLL` (5) new entries per poll, newest first, so following a 300-episode show doesn't ingest the back-catalogue at once (≈ $1 per hour of audio).

## 5. Obsidian / Notion export

`GET /items/:id/export.md` (MCP `export_markdown`) returns a note with a YAML properties block (`title`, `source`, `type`, `channel`/`site`, `author`, `published`, `duration`, `tags: marrow, marrow/<type>`), the article, references and claims with **clickable timestamp links** (`[12:34](https://youtube.com/watch?v=…&t=754s)`), and — with `?transcript=1` — the speaker-labelled transcript or the original text. Drop the file into a vault; the properties render in Obsidian's properties panel and every timecode opens the video at that second. `GET /namespaces/:name/export.md` is the index note (corpus summary, every item, the entity index).
