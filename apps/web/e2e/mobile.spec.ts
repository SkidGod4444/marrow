import { expect, expectNoHorizontalOverflow, readyItem, test } from "./helpers";

// Pixel 7 viewport: the owner's rule is that every page works at phone width — no sideways scrolling, stacked layouts.
test.describe("mobile", () => {
  for (const path of ["/", "/library", "/graph", "/namespaces/demo/chat", "/namespaces/demo/graph"]) {
    test(`no horizontal overflow on ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("item page stacks and every tab is reachable", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}`);
    await expectNoHorizontalOverflow(page);
    for (const tab of ["Chat", "Transcript", "Reader"]) {
      await page.getByRole("tab", { name: new RegExp(tab, "i") }).click();
      await expect(page.getByRole("tab", { name: new RegExp(tab, "i") })).toHaveAttribute("aria-selected", "true");
      await expectNoHorizontalOverflow(page);
    }
  });

  test("library add form is usable with a thumb", async ({ page }) => {
    await page.goto("/library");
    await page.getByRole("tab", { name: "text" }).click();
    await expect(page.getByRole("textbox", { name: "Text to capture" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const box = await page.getByRole("button", { name: "Capture" }).boundingBox();
    expect(box && box.height >= 24).toBeTruthy();
  });

  test("inbox actions have finger-sized targets", async ({ page }) => {
    await page.goto("/");
    const skip = page.getByRole("button", { name: "Skip" }).first();
    const box = await skip.boundingBox();
    expect(box && box.height >= 24 && box.width >= 40).toBeTruthy();
    await expectNoHorizontalOverflow(page);
  });
});
