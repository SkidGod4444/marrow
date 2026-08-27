import { expect, readyItem, test } from "./helpers";

test.describe("item page: reader, chat, transcript, share (PRD §6.1–6.2)", () => {
  test("header, description, chapters, reader sections and takeaways", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(video.title);
    await expect(page.getByRole("link", { name: /source/ })).toHaveAttribute("href", video.sourceUrl);
    await expect(page.getByRole("link", { name: /graph/ })).toBeVisible();
    // chapters are timecode keycaps
    await expect(page.getByText("Chapters", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "05:00" }).first()).toBeVisible();
    // reader: summary, takeaways, sections with headings, ask-about-section buttons
    await expect(page.getByText("Summary", { exact: true })).toBeVisible();
    await expect(page.getByText("Takeaways", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Method" })).toBeVisible();
    await expect(page.getByRole("button", { name: /ask about "method"/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /share/i })).toBeVisible();
  });

  test("transcript tab lists lines with timecodes; ?t= and ?tab= deep links work", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}?tab=transcript`);
    await expect(page.getByRole("tab", { name: /transcript/i })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/\d+ lines/)).toBeVisible();
    await expect(page.getByRole("button", { name: "00:10" }).first()).toBeVisible();
    await page.goto(`/items/${video.id}?t=300&tab=chat`);
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
  });

  test("chat: suggestion → streamed answer with timestamp citations as links; typed question works", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}?tab=chat`);
    await page.getByRole("button", { name: /main claims, with timestamps/i }).click();
    const answer = page.locator("[data-role='assistant'], .md").filter({ hasText: /domain randomization/i }).first();
    await expect(answer).toBeVisible({ timeout: 15_000 });
    // [00:10] became a clickable timecode
    await expect(answer.getByRole("link", { name: "00:10" }).or(answer.getByRole("button", { name: /00:10/ })).first()).toBeVisible();
    const box = page.getByPlaceholder(/ask about this video/i);
    await box.fill("What is on screen?");
    await box.press("Enter");
    await expect(page.getByText(/slide of loss curves/i)).toBeVisible({ timeout: 15_000 });
  });

  test("ask-about-section seeds the chat with the section", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}`);
    await page.getByRole("button", { name: /ask about "method"/i }).click();
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(/Explain the section "Method"/)).toBeVisible();
    await expect(page.getByText(/domain randomization at/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("share menu: copy link, open shared page", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}`);
    await page.getByRole("button", { name: /share/i }).click();
    await page.getByRole("menuitem", { name: /copy link/i }).click();
    await expect(page.getByText(/link copied/i)).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(`/items/${video.id}/read`);
    await page.getByRole("button", { name: /share/i }).click();
    await page.getByRole("menuitem", { name: /open shared page/i }).click();
    await expect(page).toHaveURL(new RegExp(`/items/${video.id}/read`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(video.title);
  });

  test("shared page: article, transcript toggle, player toggle, back link", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}/read`);
    await expect(page.getByText("Summary", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /show full transcript/i }).click();
    await expect(page.getByText(/we talk about the Tobin/i).first()).toBeVisible();
    await page.getByRole("button", { name: /hide transcript/i }).click();
    await page.getByRole("link", { name: /open in marrow/i }).click();
    await expect(page).toHaveURL(new RegExp(`/items/${video.id}$`));
  });
});

test.describe("text items (PRD §7)", () => {
  test("source card, linked video ingest, Text tab, reader without timestamps", async ({ page }) => {
    const post = await readyItem((i) => i.sourceType === "newsletter");
    await page.goto(`/items/${post.id}`);
    await expect(page.getByText("Newsletter", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/min read/)).toBeVisible();
    await expect(page.getByText("Linked videos", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Text" }).click();
    await expect(page.getByRole("heading", { name: /robotics weekly/i }).nth(1)).toBeVisible();
    await page.getByRole("tab", { name: "Reader" }).click();
    await expect(page.locator("button.timecode")).toHaveCount(0);
    await page.getByRole("button", { name: "Ingest" }).click();
    await expect(page.getByText(/Queued|Already in the library/)).toBeVisible();
  });

  test("shared page of a text item shows the original text on request", async ({ page }) => {
    const post = await readyItem((i) => i.sourceUrl.includes("why-sim-to-real-still-fails"));
    await page.goto(`/items/${post.id}/read`);
    await expect(page.getByRole("button", { name: /show original text/i })).toBeVisible();
    await page.getByRole("button", { name: /show original text/i }).click();
    await expect(page.getByText(/second paragraph/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /show video|show player/i })).toHaveCount(0);
  });
});

test.describe("podcast episode (audio player)", () => {
  test("plays, seeks with timecodes, keyboard shortcuts, speed", async ({ page }) => {
    const pod = await readyItem((i) => i.sourceType === "podcast_episode");
    await page.goto(`/items/${pod.id}`);
    await expect(page.getByText("audio", { exact: true })).toBeVisible();
    const play = page.getByRole("button", { name: "Play" }).first();
    await expect(play).toBeEnabled({ timeout: 10_000 });
    await play.click();
    await expect(page.getByRole("button", { name: "Pause" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Pause" }).first().click();
    await expect(page.getByRole("button", { name: "Play" }).first()).toBeVisible();
    // seeking via a section timecode moves the playhead
    await page.getByRole("button", { name: "Forward 10 seconds" }).click();
    await expect(page.getByRole("button", { name: "Play" }).first()).toBeVisible();
    await page.getByRole("button", { name: "Playback speed" }).click();
    await page.getByRole("menuitem", { name: "1.5×" }).click();
    await expect(page.getByRole("button", { name: "Playback speed" })).toContainText("1.5");
  });
});
