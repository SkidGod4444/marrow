import { expect, test } from "./helpers";

// Runs only against an EMPTY corpus (E2E_EMPTY=1 with `E2E_SEED=0 ./scripts/e2e-stack.sh`): the very first visit.
test.describe("first run", () => {
  test.skip(process.env.E2E_EMPTY !== "1", "needs an empty corpus (E2E_EMPTY=1)");

  test("graph explains itself when empty", async ({ page }) => {
    await page.goto("/graph");
    await expect(page.getByText(/nothing to draw yet/i)).toBeVisible();
    await page.getByRole("link", { name: /add something in the library/i }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByText(/nothing here yet/i)).toBeVisible();
  });

  test("welcome panel guides the first add: paste a link → name a namespace → it lands in the inbox", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /turn a video into something/i })).toBeVisible();
    await expect(page.getByText("Show skipped")).toHaveCount(0);
    await page.getByRole("textbox", { name: "URL" }).fill("https://www.youtube.com/watch?v=my-first-video");
    const add = page.getByRole("button", { name: /^add( to .+)?$/i });
    await expect(add).toBeEnabled();
    await add.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: /name a namespace first/i })).toBeVisible();
    await dialog.getByRole("textbox", { name: "Namespace name" }).fill("robotics");
    await dialog.getByRole("button", { name: /create and add/i }).click();
    await expect(page.getByText("Namespace created")).toBeVisible();
    await expect(page.getByText("Queued", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /my first video/i })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /turn a video into something/i })).toHaveCount(0);
  });

});
