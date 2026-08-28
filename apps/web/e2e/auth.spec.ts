import { expect, test } from "./helpers";

// Owner login: the whole app sits behind it; sign-up is closed after the first account.
test.describe("owner login", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signed out: every page and the API proxy redirect or refuse; login page explains itself", async ({ page }) => {
    await page.goto("/library");
    await expect(page).toHaveURL(/\/login\?next=%2Flibrary/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Library" })).toHaveCount(0); // no nav for strangers
    const api = await page.request.get("/api/marrow/namespaces");
    expect(api.status()).toBe(401);
  });

  test("wrong password → plain error; right password → in, with a user menu; sign out → back to login", async ({ page }) => {
    await page.goto("/login?next=%2Flibrary");
    await page.getByRole("textbox", { name: "Email" }).fill("owner@marrow.local");
    await page.getByRole("textbox", { name: "Password" }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#login-error")).toContainText(/wrong email or password/i);
    await page.getByRole("textbox", { name: "Password" }).fill("marrow-owner");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await page.getByRole("button", { name: /signed in as owner@marrow.local/i }).click();
    await expect(page.getByText("owner@marrow.local")).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a second account cannot be created", async ({ page }) => {
    const res = await page.request.post("/api/auth/sign-up/email", { data: { email: "intruder@example.com", password: "letmein12345", name: "X" }, headers: { origin: "http://localhost:3100" } });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(await res.text()).toMatch(/single-owner|already exists/i);
  });
});
