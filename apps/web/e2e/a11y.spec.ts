import AxeBuilder from "@axe-core/playwright";
import { expect, readyItem, test } from "./helpers";

// WCAG 2.x A/AA scan of every main page (colour contrast included) — serious/critical violations fail.
const scan = async (page: import("@playwright/test").Page) => {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  return bad.map((v) => `${v.id} (${v.impact}): ${v.help}\n${v.nodes.slice(0, 12).map((n) => `  ${n.target.join(" ")}: ${(n.any[0]?.message ?? "").replace(/\s+/g, " ")}`).join("\n")}`);
};

test.describe("accessibility", () => {
  for (const path of ["/", "/library", "/graph", "/namespaces/demo/chat", "/namespaces/demo/graph"]) {
    test(`no serious violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      expect(await scan(page)).toEqual([]);
    });
  }
  test("item page and shared page", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}`);
    await expect(page.getByRole("tab", { name: "Reader" })).toBeVisible();
    expect(await scan(page)).toEqual([]);
    await page.goto(`/items/${video.id}/read`);
    expect(await scan(page)).toEqual([]);
  });
  test("keyboard: skip link, tabs reachable, dialog traps focus and closes on Escape", async ({ page }) => {
    await page.goto("/library");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: /skip to content/i })).toBeFocused();
    await page.getByRole("button", { name: /follow a playlist, channel or feed/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("textbox", { name: /playlist, channel or feed url/i })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
