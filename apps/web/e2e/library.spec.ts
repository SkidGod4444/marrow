import { RUN, expect, test } from "./helpers";

test.describe("library: namespaces, adding, following", () => {
  test("shows namespaces with counts, summary, items with kinds", async ({ page }) => {
    await page.goto("/library");
    await expect(page.getByText(/\d+ namespaces? · \d+ items?/).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "demo" })).toBeVisible();
    await expect(page.getByText(/\d+\/\d+ ready/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Chat →" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Graph →" }).first()).toBeVisible();
    await expect(page.getByText("Podcast", { exact: true }).first()).toBeVisible();
  });

  test("adds a YouTube link → queued → appears in the inbox once ingested", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("textbox", { name: "URL" }).fill(`https://www.youtube.com/watch?v=new-video-from-e2e-${RUN}`);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Queued", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`new video from e2e ${RUN}`, "i") })).toBeVisible({ timeout: 30_000 });
  });

  test("adds the same link again → Already in the library", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("textbox", { name: "URL" }).fill(`https://youtu.be/new-video-from-e2e-${RUN}`);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Already in the library")).toBeVisible();
  });

  test("captures an article URL and pasted text", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("textbox", { name: "URL" }).fill(`https://blog.example.com/posts/an-article-from-e2e-${RUN}`);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText("Captured", { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 2, name: new RegExp(`an article from e2e ${RUN}`, "i") })).toBeVisible({ timeout: 30_000 });

    await page.goto("/library");
    await page.getByRole("tab", { name: "text" }).click();
    await page.getByRole("textbox", { name: "Title" }).fill(`Pasted note from e2e ${RUN}`);
    await page.getByRole("textbox", { name: "Text to capture" }).fill(`Backlash compensation matters for sim-to-real. This pasted note (${RUN}) is long enough to be captured as a post in the demo namespace.`);
    await page.getByRole("button", { name: "Capture" }).click();
    await expect(page.getByText("Captured", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: `Pasted note from e2e ${RUN}` })).toBeVisible({ timeout: 30_000 });
  });

  test("social links need the text — plain-language error", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("textbox", { name: "URL" }).fill("https://x.com/someone/status/1");
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(/share the post text/i)).toBeVisible();
  });

  test("creates a namespace from the dropdown and adds into it", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("combobox", { name: "Namespace" }).click();
    await page.getByRole("option", { name: "New namespace…" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "New namespace" })).toBeVisible();
    await dialog.getByRole("textbox", { name: "Namespace name" }).fill(`E2E Space ${RUN}`);
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(page.getByText("Namespace created")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Namespace" })).toContainText(`e2e-space-${RUN}`);
    await expect(page.getByRole("heading", { name: `e2e-space-${RUN}` })).toBeVisible();
  });

  test("follows a feed: first check queues episodes; Check now and Unfollow work", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("button", { name: /follow a playlist, channel or feed/i }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: /playlist, channel or feed url/i }).fill("https://robottalk.example.com/feed.xml");
    await dialog.getByRole("button", { name: "Follow" }).click();
    await expect(page.getByText(/Following|queued/).first()).toBeVisible();
    await expect(page.getByText("rss", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Check now" }).first().click();
    await expect(page.getByText(/Nothing new|queued/).first()).toBeVisible();
    await page.getByRole("button", { name: "Unfollow" }).first().click();
    await expect(page.getByText("nothing yet").first()).toBeVisible();
  });
});
