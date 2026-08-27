import { expect, readyItem, test } from "./helpers";

test.describe("namespace chat (PRD §6.1) and knowledge graph", () => {
  test("chat answers with citations to at least two items; namespace switcher; ?q= seeds a question", async ({ page }) => {
    await page.goto("/namespaces/demo/chat");
    await expect(page.getByRole("combobox", { name: "Namespace" })).toContainText("demo");
    await expect(page.getByText("What this corpus covers")).toBeVisible();
    await page.getByRole("button", { name: /what does this corpus cover/i }).click();
    await expect(page.getByText(/Two items cover this/)).toBeVisible({ timeout: 15_000 });
    const cites = page.locator("a[href*='/items/'][href*='?t=']");
    await expect(cites.nth(1)).toBeVisible({ timeout: 15_000 }); // the answer streams in; two distinct items are cited
    expect(await cites.count()).toBeGreaterThanOrEqual(2);
    await cites.first().click();
    await expect(page).toHaveURL(/\/items\/.*\?t=\d+/);
    await page.goto("/namespaces/demo/chat?q=Compare%20backlash%20models");
    await expect(page.getByText("Compare backlash models")).toBeVisible();
    await expect(page.getByText(/Two items cover this/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("combobox", { name: "Namespace" }).click();
    await page.getByRole("option", { name: /^papers/ }).click();
    await expect(page).toHaveURL(/\/namespaces\/papers\/chat/);
  });

  test("/graph picks between namespaces; graph renders nodes, layouts, filters, selection panel, export", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/graph");
    await expect(page.getByRole("heading", { name: /pick a namespace/i })).toBeVisible();
    await page.getByRole("link", { name: /demo/ }).first().click();
    await expect(page).toHaveURL(/\/namespaces\/demo\/graph/);
    await expect(page.getByText(/\d+ of \d+ nodes/)).toBeVisible();
    const nodes = page.locator("svg [data-node]");
    expect(await nodes.count()).toBeGreaterThan(5);
    await expect(page.getByText("Hubs")).toBeVisible();
    // layouts
    for (const name of ["Radial", "Columns", "Force"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      expect(await nodes.count()).toBeGreaterThan(5);
    }
    // selection → panel with claims/stance and Ask the corpus
    await page.getByRole("button", { name: /^technique: domain randomization/i }).click();
    await expect(page.getByRole("heading", { name: "Domain randomization" })).toBeVisible();
    await expect(page.getByText("Appears in")).toBeVisible();
    await expect(page.getByText(/supporting/)).toBeVisible();
    await expect(page.getByRole("link", { name: /ask the corpus/i })).toHaveAttribute("href", /\/namespaces\/demo\/chat\?q=/);
    // search + kind filter + contested toggle
    await page.getByRole("textbox", { name: /find a node/i }).fill("tobin");
    await expect(page.getByRole("button", { name: /paper: tobin/i })).toBeVisible();
    await page.getByRole("button", { name: /clear search/i }).click();
    const before = await nodes.count();
    await page.getByRole("button", { name: /^technique \d+$/ }).click();
    expect(await nodes.count()).toBeLessThan(before);
    await page.getByRole("button", { name: /^technique \d+$/ }).click();
    await page.getByRole("button", { name: /contested only/i }).click();
    await expect(page.getByText(/1 of \d+ nodes|\d+ of \d+ nodes/)).toBeVisible();
    await page.getByRole("button", { name: /contested only/i }).click();
    // export menu
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: /copy entity list/i }).click();
    await expect(page.getByText("Copied", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("# demo — entities");
    // keyboard: Escape clears the selection
    await page.keyboard.press("Escape");
    await expect(page.getByText("Hubs")).toBeVisible();
  });

  test("graph focus from an item page highlights that item", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}`);
    await page.getByRole("link", { name: /graph/ }).click();
    await expect(page).toHaveURL(new RegExp(`focus=${video.id}`));
    await expect(page.getByRole("heading", { name: video.title })).toBeVisible();
    await expect(page.getByRole("link", { name: /^open/i })).toHaveAttribute("href", `/items/${video.id}`);
  });
});
