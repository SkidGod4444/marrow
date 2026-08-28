import { RUN, api, expect, readyItem, test } from "./helpers";

// PRD §6.3 / §14 Phase 6: a podcast in a language-learning namespace yields ≥10 expressions with playable exact-span
// clips; "Learn" puts one in the review queue; recall prompts come back 2d → 7d → 30d.
test.describe("language mode + review queue", () => {
  test("Language tab: ≥10 expressions, each with a playable clip and a jump link; Learn adds to review", async ({ page }) => {
    const ep = await readyItem((i) => i.sourceType === "podcast_episode", "english");
    await page.goto(`/items/${ep.id}?tab=language`);
    await expect(page.getByRole("tab", { name: /language/i })).toHaveAttribute("aria-selected", "true");
    const rows = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^learn$|^learning$/i }) });
    expect(await rows.count()).toBeGreaterThanOrEqual(10);
    // every row has a play button + a timecode that seeks the player; pick one not yet saved (stack is reused across runs)
    const candidate = rows.filter({ has: page.getByRole("button", { name: "Learn", exact: true }) }).first();
    const phrase = (await candidate.locator("p").first().innerText()).split("\n")[0]!.trim();
    const row = rows.filter({ hasText: phrase }).first(); // stable handle: the button label changes after Learn
    await row.getByRole("button", { name: /play clip/i }).click();
    await expect(row.getByRole("button", { name: /stop clip/i })).toBeVisible();
    await expect(row.getByRole("button", { name: /play clip/i })).toBeVisible({ timeout: 10_000 }); // 1-second clip ends
    await row.locator("button.timecode").click();
    // Learn → review
    await row.getByRole("button", { name: "Learn", exact: true }).click();
    await expect(page.getByText("Added to review")).toBeVisible();
    await expect(row.getByRole("button", { name: "Learning" })).toBeVisible();
    await expect(row.getByText(/in review · next/)).toBeVisible();
    // the review nav badge is only for due items (none yet); the Review page lists it as upcoming
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: /^practice/i }).click();
    await expect(page.getByRole("heading", { name: "Practice" })).toBeVisible();
    await expect(page.getByText(/nothing due right now/i)).toBeVisible();
    await expect(page.getByText("Coming up")).toBeVisible();
  });

  test("recall prompt: show meaning → Got it advances to 7 days; Again restarts at 2 days", async ({ page }) => {
    const ep = await readyItem((i) => i.sourceType === "podcast_episode", "english");
    const n = 3 + (Number(RUN) % 5); // a different expression per run; start it fresh either way
    await api(`/items/${ep.id}/expressions/${n}/save`, { method: "DELETE" }).catch(() => undefined);
    await api(`/items/${ep.id}/expressions/${n}/save`, { method: "POST" });
    const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
    await page.goto(`/review?now=${encodeURIComponent(future)}`);
    await expect(page.getByText(/card 1 of \d+/)).toBeVisible();
    const card = page.getByRole("heading", { level: 2 }).first();
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: /show meaning/i }).click();
    await expect(page.getByText(/Meaning of/)).toBeVisible();
    await page.getByRole("button", { name: /got it/i }).click();
    await expect(page.getByText("Got it", { exact: true })).toBeVisible();
    // The schedule itself, on our own review (the page may have shown an older due card first): 2d → 7d → 30d, again → 2d.
    const mine = (await api<{ expressions: Array<{ n: number; review_id: string | null }> }>(`/items/${ep.id}/expressions`)).expressions.find((e) => e.n === n)!;
    expect(mine.review_id).toBeTruthy();
    const day = 24 * 3600 * 1000;
    const got = await api<{ review: { stage: number; dueAt: string } }>(`/reviews/${mine.review_id}/answer`, { method: "POST", body: JSON.stringify({ result: "got_it" }) });
    expect(got.review.stage).toBeGreaterThanOrEqual(1); // 1, or 2 if the page just answered this very card
    const stage = got.review.stage;
    expect(Math.abs(new Date(got.review.dueAt).getTime() - (Date.now() + (stage === 1 ? 7 : 30) * day))).toBeLessThan(60_000);
    const again = await api<{ review: { stage: number; dueAt: string } }>(`/reviews/${mine.review_id}/answer`, { method: "POST", body: JSON.stringify({ result: "again" }) });
    expect(again.review.stage).toBe(0);
    expect(Math.abs(new Date(again.review.dueAt).getTime() - (Date.now() + 2 * day))).toBeLessThan(60_000);
  });

  test("library: language mode can be switched per namespace; new-namespace dialog offers it", async ({ page }) => {
    await page.goto("/library");
    const english = page.locator("section").filter({ has: page.getByRole("heading", { name: "english" }) });
    await expect(english.getByRole("button", { name: /language mode on/i })).toBeVisible();
    const demo = page.locator("section").filter({ has: page.getByRole("heading", { name: "demo", exact: true }) });
    const toggle = demo.getByRole("button", { name: /language mode/i });
    const wasOn = (await toggle.getAttribute("aria-pressed")) === "true";
    await toggle.click();
    await expect(page.locator("[data-sonner-toast]").getByText(wasOn ? "Language mode off" : "Language mode on")).toBeVisible();
    await expect(demo.getByRole("button", { name: /language mode/i })).toHaveAttribute("aria-pressed", wasOn ? "false" : "true");
    await demo.getByRole("button", { name: /language mode/i }).click();
    await expect(page.locator("[data-sonner-toast]").getByText(wasOn ? "Language mode on" : "Language mode off")).toBeVisible();
    await page.getByRole("combobox", { name: "Namespace" }).click();
    await page.getByRole("option", { name: "New namespace…" }).click();
    await expect(page.getByRole("dialog").getByRole("checkbox", { name: /language learning/i })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
