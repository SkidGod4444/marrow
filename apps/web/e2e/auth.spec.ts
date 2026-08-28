import { RUN, expect, test } from "./helpers";
import { USERS, WORKSPACE } from "./users";

// Accounts: anyone can sign up; every account gets a workspace of its own; the app sits behind sign-in.
test.describe("accounts", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("signed out: pages redirect to sign-in, the API proxy refuses, and the login page explains itself", async ({ page }) => {
    await page.goto("/library");
    await expect(page).toHaveURL(/\/login\?next=%2Flibrary/);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Library" })).toHaveCount(0); // no nav for strangers
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
    const api = await page.request.get("/api/marrow/namespaces");
    expect(api.status()).toBe(401);
    expect((await page.request.get("/api/version")).status()).toBe(200); // build identity stays public
  });

  test("wrong password → plain error; right password → in, in the Demo Lab workspace; sign out → back to login", async ({ page }) => {
    await page.goto("/login?next=%2Flibrary");
    await page.getByRole("textbox", { name: "Email" }).fill(USERS.owner.email);
    await page.getByRole("textbox", { name: "Password" }).fill("not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.locator("#login-error")).toContainText(/wrong email or password/i);
    await page.getByRole("textbox", { name: "Password" }).fill(USERS.owner.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/library$/);
    await expect(page.getByRole("button", { name: `Workspace: ${WORKSPACE.name}` })).toBeVisible();
    await expect(async () => {
      await page.getByRole("button", { name: `Signed in as ${USERS.owner.email}` }).click();
      await expect(page.getByRole("menuitem", { name: /sign out/i })).toBeVisible({ timeout: 1500 });
    }).toPass();
    await expect(page.getByRole("menu").getByText(USERS.owner.email)).toBeVisible();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a newcomer signs up and lands in a workspace of their own, empty and ready for the first add", async ({ page }) => {
    const email = `newcomer-${RUN}@example.com`;
    await page.goto("/login");
    await page.getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(/\/signup/);
    await page.getByRole("textbox", { name: "Name" }).fill("Nia Newcomer");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("textbox", { name: "Password" }).fill("a-long-passphrase");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("button", { name: /Workspace: Nia Newcomer/ })).toBeVisible();
    // Their own workspace, where they are the owner — and none of the Demo Lab corpus leaks in.
    const me = (await (await page.request.get("/api/marrow/me")).json()) as { organizations: Array<{ role: string; slug: string }>; permissions: string[] };
    expect(me.organizations).toHaveLength(1);
    expect(me.organizations[0]?.role).toBe("owner");
    expect(me.permissions).toEqual(expect.arrayContaining(["item:add", "member:create", "apikey:manage"]));
    await expect(page.getByRole("heading", { name: /turn a video into something/i })).toBeVisible();
    const ns = (await (await page.request.get("/api/marrow/namespaces")).json()) as { namespaces: unknown[] };
    expect(ns.namespaces).toEqual([]);
  });
});
