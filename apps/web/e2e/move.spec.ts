import { RUN, api, expect, test } from "./helpers";

// A misfiled item is one pick away from the right namespace; landing in a language-mode namespace brings expressions.
test("move an item to another namespace from its page; a language namespace picks expressions on arrival", async ({ page }) => {
  const url = `https://www.youtube.com/watch?v=move-${RUN}`;
  const r = await api<{ item_id: string }>("/ingest", { method: "POST", body: JSON.stringify({ namespace: "demo", url }) });
  await expect.poll(async () => (await api<{ item: { status: string } }>(`/items/${r.item_id}`)).item.status, { timeout: 40_000 }).toBe("ready");
  const english = (await api<{ namespaces: Array<{ id: string; name: string }> }>("/namespaces")).namespaces.find((n) => n.name === "english")!;

  await page.goto(`/items/${r.item_id}`);
  await expect(page.getByRole("tab", { name: /Language/ })).toHaveCount(0);
  const ns = page.getByRole("combobox", { name: "Namespace" });
  await expect(ns).toContainText("demo");
  await ns.click();
  await page.getByRole("option", { name: /^english/ }).click();
  await expect(page.getByText("Moved to english")).toBeVisible();
  await expect.poll(async () => (await api<{ item: { namespaceId: string } }>(`/items/${r.item_id}`)).item.namespaceId).toBe(english.id);

  // the language pass ran on arrival
  await expect.poll(async () => (await api<{ expressions: unknown[] }>(`/items/${r.item_id}/expressions`)).expressions.length, { timeout: 40_000 }).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "Namespace" })).toContainText("english");
  await expect(page.getByRole("tab", { name: /Language/ })).toBeVisible();

  // a finished copy already in the target is refused in plain words
  const dup = await api<{ item_id: string }>("/ingest", { method: "POST", body: JSON.stringify({ namespace: "demo", url }) });
  await expect.poll(async () => (await api<{ item: { status: string } }>(`/items/${dup.item_id}`)).item.status, { timeout: 40_000 }).toBe("ready");
  await page.goto(`/items/${dup.item_id}`);
  await page.getByRole("combobox", { name: "Namespace" }).click();
  await page.getByRole("option", { name: /^english/ }).click();
  await expect(page.getByText(/already has this one/)).toBeVisible();

  // leave the inbox as we found it
  await api(`/items/${r.item_id}/archive`, { method: "POST" });
  await api(`/items/${dup.item_id}/archive`, { method: "POST" });
});
