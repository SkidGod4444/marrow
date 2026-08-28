import { RUN, api, expect, items, test } from "./helpers";

/** A video whose transcription always fails (fake pipeline): gives the inbox a failed card to work with. */
async function brokenItem(): Promise<string> {
  const r = await api<{ item_id: string }>("/ingest", { method: "POST", body: JSON.stringify({ namespace: "demo", url: `https://www.youtube.com/watch?v=broken-${RUN}` }) });
  await expect.poll(async () => (await items()).find((i) => i.id === r.item_id)?.status, { timeout: 30_000 }).toBe("failed");
  return r.item_id;
}

test.describe("inbox (PRD §6.4)", () => {
  test("lists ready items with kind badges, summaries and novelty; failed item offers Retry", async ({ page }) => {
    await brokenItem();
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
    await expect(page.getByText(/\d+ to watch/)).toBeVisible();
    // kinds beyond video are labelled
    await expect(page.getByText("Podcast", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Newsletter", { exact: true }).first()).toBeVisible();
    // the failed ingest shows a plain-language card with Retry
    const failed = page.getByText(/couldn.t finish this one/i).first();
    await expect(failed).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" }).first()).toBeVisible();
    // every ready entry has Read + Chat
    const first = page.locator("li").filter({ has: page.getByRole("link", { name: "Read" }) }).first();
    await expect(first.getByRole("link", { name: "Chat" })).toBeVisible();
  });

  test("skip hides an item with an undo toast; Show skipped brings it back", async ({ page }) => {
    await page.goto("/");
    const entry = page.locator("li").filter({ has: page.getByRole("link", { name: "Read" }) }).filter({ has: page.getByRole("button", { name: "Skip" }) }).first();
    const title = (await entry.getByRole("heading", { level: 2 }).textContent())?.trim() ?? "";
    expect(title.length).toBeGreaterThan(0);
    await entry.getByRole("button", { name: "Skip" }).click();
    await expect(page.getByText("Skipped", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Show skipped" }).click();
    const skipped = page.locator("li").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });
    await expect(skipped).toHaveCount(1);
    await skipped.getByRole("button", { name: "Unskip" }).click();
    await expect(page.getByText("Back in the inbox")).toBeVisible();
    await page.getByRole("link", { name: "Hide skipped" }).click();
    await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toHaveCount(1);
  });

  test("novelty verdict links deep into the item", async ({ page }) => {
    await page.goto("/");
    const badge = page.getByText(/% new|all new|nothing new/).first();
    await expect(badge).toBeVisible();
    const link = page.locator("a[href*='/items/'][href*='?t=']").first();
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    await link.click();
    await expect(page).toHaveURL(new RegExp(href!.replace("?", "\\?")));
  });

  test("Read opens the reader, Chat opens the chat tab", async ({ page }) => {
    await page.goto("/");
    const entry = page.locator("li").filter({ has: page.getByRole("link", { name: "Read" }) }).first();
    await entry.getByRole("link", { name: "Chat" }).click();
    await expect(page).toHaveURL(/tab=chat/);
    await expect(page.getByRole("tab", { name: "Chat" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByPlaceholder(/ask about this/i)).toBeVisible();
  });

  test("retry picks the failed item up where it stopped", async ({ page }) => {
    const id = await brokenItem();
    await page.goto("/");
    const card = page.locator("li").filter({ has: page.getByRole("button", { name: "Retry" }) }).first();
    await expect(card.getByText(/failed while transcribing/i)).toBeVisible();
    await card.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText("Retrying", { exact: true })).toBeVisible();
    // Earlier stages are kept (fetch is not redone); the item ends up ready or failed again — never stuck.
    await expect.poll(async () => (await items()).find((i) => i.id === id)?.status, { timeout: 40_000 }).toMatch(/^(ready|failed)$/);
    await page.reload();
    await expect(page.getByText(/queued…|transcribing…/i)).toHaveCount(0);
  });
});
