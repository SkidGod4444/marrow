import { RUN, api, expect, test } from "./helpers";

// An ingest in flight must never look stuck: the inbox card and the library row show which step is running, how far
// along it is, how long it has taken and what is probably left — polled live — and turn into the real item when done.
// The fake pipeline's transcription of a "slow" video takes ~8 s, long enough to watch.
test("a queued video shows live step-by-step progress until it lands", async ({ page }) => {
  const url = `https://www.youtube.com/watch?v=slow-${RUN}`;
  const r = await api<{ item_id: string; job_id: string }>("/ingest", { method: "POST", body: JSON.stringify({ namespace: "demo", url }) });

  await page.goto("/");
  const card = page.locator("#main li").filter({ hasText: `slow ${RUN}` }).first();
  await expect(card).toBeVisible();
  const bar = card.getByRole("progressbar", { name: "Ingest progress" });
  await expect(bar).toBeVisible();
  await expect(card.getByText(/step \d+ of \d+/)).toBeVisible();
  await expect(card.getByText(/\d+:\d\d elapsed/)).toBeVisible({ timeout: 5000 });
  await expect(card.getByText(/Transcribing…/)).toBeVisible({ timeout: 15_000 }); // the slow step
  await expect(card.getByText(/left|starting soon|longer than usual/)).toBeVisible();
  await expect(card.getByText(/usually about \d+ minutes|a couple of minutes/)).toBeVisible();
  const before = Number(await bar.getAttribute("aria-valuenow"));
  expect(before).toBeGreaterThanOrEqual(0);
  await page.screenshot({ path: `${process.env.E2E_SHOT_DIR ?? "test-results"}/progress-inbox.png` });

  // The library row shows the same, compactly.
  await page.goto("/library");
  const row = page.locator("#main li").filter({ hasText: `slow ${RUN}` }).first();
  await expect(row.getByRole("progressbar", { name: "Ingest progress" })).toBeVisible();
  await expect(row.getByText(/\d+\/\d+/)).toBeVisible();
  await page.screenshot({ path: `${process.env.E2E_SHOT_DIR ?? "test-results"}/progress-library.png` });

  // …and when the pipeline finishes, the page re-renders on its own into a real entry.
  await expect.poll(async () => (await api<{ item: { status: string } }>(`/items/${r.item_id}`)).item.status, { timeout: 40_000 }).toBe("ready");
  await page.goto("/");
  await expect(page.locator("#main li").filter({ hasText: `slow ${RUN}` }).first().getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("link", { name: new RegExp(`slow ${RUN}`) }).first()).toBeVisible();
});
