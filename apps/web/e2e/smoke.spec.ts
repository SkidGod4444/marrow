import { expect, expectNoHorizontalOverflow, readyItem, test } from "./helpers";

test.describe("smoke: every page loads without browser errors", () => {
  test("navbar: brand, links, current-page state", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByRole("link", { name: "Inbox" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Library" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Library" })).toHaveAttribute("aria-current", "page");
    await nav.getByRole("link", { name: "Graph" }).click();
    await expect(page).toHaveURL(/\/graph$/);
    await expect(nav.getByRole("link", { name: "Graph" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: /marrow/i }).first().click();
    await expect(page).toHaveURL(/\/$/);
  });

  for (const path of ["/", "/library", "/graph", "/namespaces/demo/chat", "/namespaces/demo/graph"]) {
    test(`renders ${path}`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status(), "HTTP status").toBeLessThan(400);
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("item, read and text pages", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(video.title);
    await expect(page.getByRole("tab", { name: "Reader" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.goto(`/items/${video.id}/read`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(video.title);
    await expectNoHorizontalOverflow(page);
    const post = await readyItem((i) => i.sourceType === "captured_post");
    await page.goto(`/items/${post.id}`);
    await expect(page.getByRole("tab", { name: "Text" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("unknown item and unknown route show the not-found page with a way back", async ({ page }) => {
    // Streaming shells answer 200; what matters to a person is the page itself: plain words and a way out.
    await page.goto("/items/vid_doesnotexist");
    await expect(page.getByRole("heading", { name: /nothing at this address/i })).toBeVisible();
    await page.getByRole("link", { name: /back to the inbox/i }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/nope/nothing");
    await expect(page.getByRole("heading", { name: /nothing at this address/i })).toBeVisible();
  });
});
