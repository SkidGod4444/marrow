import { expect, readyItem, test } from "./helpers";

// Every item shows what it cost — tokens and dollars, pipeline and chat — with the ledger a hover away.
test("an item's spend: chip in the meta line, ledger on hover, cost on the inbox card", async ({ page }) => {
  const video = await readyItem((i) => i.sourceType === "youtube_video");
  await page.goto(`/items/${video.id}`);
  const chip = page.getByRole("button", { name: "What this item cost" });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText(/\$\d+\.\d\d|<\$0\.01/);
  await expect(chip).toContainText(/tokens/);
  await chip.hover();
  const card = page.getByText(/API spend for this item/i);
  await expect(card).toBeVisible();
  await expect(page.getByRole("cell", { name: "Transcribing" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Total" })).toBeVisible();

  await page.goto("/");
  await expect(page.locator("#main li").filter({ hasText: video.title }).first().getByText(/\$\d+\.\d\d|<\$0\.01/)).toBeVisible();
});
