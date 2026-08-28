import { RUN, api, expect, test } from "./helpers";
import { storageState } from "./users";

// Settings → Namespaces: admins/owners rename inline and delete after a confirmation; everyone else just sees the list.
// Rows are scoped to #main because toasts are list items too.
test.describe("settings · namespaces", () => {
  test("owner renames a namespace inline (taken names are refused) and deletes one after confirming", async ({ page }) => {
    const name = `scratch-${RUN}`;
    const renamed = `renamed-${RUN}`;
    await api("/namespaces", { method: "POST", body: JSON.stringify({ name }) });
    await page.goto("/settings");
    const rows = page.locator("#main").getByRole("listitem");
    const row = rows.filter({ hasText: name });
    // While editing, the name lives in the input's value (not text), so the editor is found by its labelled textbox.
    const editor = (of: string) => page.locator("#main form").filter({ has: page.getByRole("textbox", { name: `New name for ${of}` }) });
    await expect(row).toBeVisible();
    await expect(row).toContainText("0 items");

    await row.getByRole("button", { name: "Rename", exact: true }).click();
    await editor(name).getByRole("textbox").fill(renamed);
    await editor(name).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(`Renamed to ${renamed}`)).toBeVisible();
    const row2 = rows.filter({ hasText: renamed });
    await expect(row2).toBeVisible();
    await expect(rows.filter({ hasText: name })).toHaveCount(0);

    // A name that is already taken in this workspace is refused in plain words; nothing changes.
    await row2.getByRole("button", { name: "Rename", exact: true }).click();
    await editor(renamed).getByRole("textbox").fill("demo");
    await editor(renamed).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(/already exists/)).toBeVisible();
    await editor(renamed).getByRole("button", { name: "Cancel" }).click();
    await expect(row2).toContainText(renamed);

    // Delete asks first; "Keep it" changes nothing.
    await row2.getByRole("button", { name: `Delete ${renamed}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Delete ${renamed}?` })).toBeVisible();
    await expect(dialog).toContainText("There is no undo");
    await page.screenshot({ path: `${process.env.E2E_SHOT_DIR ?? "test-results"}/settings-delete.png` });
    await dialog.getByRole("button", { name: "Keep it" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row2).toBeVisible();

    await row2.getByRole("button", { name: `Delete ${renamed}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: `Delete ${renamed}` }).click();
    await expect(page.getByText(`Deleted ${renamed}`)).toBeVisible();
    await expect(row2).toHaveCount(0);
    const names = (await api<{ namespaces: Array<{ name: string }> }>("/namespaces")).namespaces.map((n) => n.name);
    expect(names).not.toContain(renamed);
    expect(names).toContain("demo");
  });

  test.describe("viewer", () => {
    test.use({ storageState: storageState("viewer") });
    test("sees the namespaces but no rename or delete controls", async ({ page }) => {
      await page.goto("/settings");
      const rows = page.locator("#main").getByRole("listitem");
      await expect(rows.filter({ hasText: "demo" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Rename", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
      await page.screenshot({ path: `${process.env.E2E_SHOT_DIR ?? "test-results"}/settings-viewer.png`, fullPage: true });
    });
  });
});
