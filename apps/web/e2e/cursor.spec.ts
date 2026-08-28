import type { Page } from "@playwright/test";
import { expect, readyItem, test } from "./helpers";

// Owner rule: every clickable shows cursor: pointer. Two ways something is clickable — it carries a React click handler
// (found through React's props on the DOM node) or it has an interactive role. Anything else the browser default
// applies to (inputs, textareas, disabled controls) is skipped; drag handles may use grab.
const INTERACTIVE = 'button, a[href], summary, select, label[for], [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="combobox"], [role="slider"]';

async function offenders(page: Page): Promise<string[]> {
  return page.evaluate((selector: string) => {
    const ALLOWED = new Set(["pointer", "grab", "grabbing"]);
    const out = new Set<string>();
    const describe = (el: Element) => {
      const role = el.getAttribute("role");
      const slot = el.getAttribute("data-slot");
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).slice(0, 3).join(".");
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
      return `${el.tagName.toLowerCase()}${role ? `[role=${role}]` : ""}${slot ? `[slot=${slot}]` : ""}${cls ? `.${cls}` : ""} "${text}"`;
    };
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (!(el instanceof HTMLElement) && !(el instanceof SVGElement)) continue;
      if (el.closest("input, textarea, [contenteditable]") || el.matches("input, textarea, [contenteditable]")) continue;
      // Containers whose handlers exist for dismissal/focus, not for clicking; and the graph canvas (its nodes are checked).
      if (el.matches('[role="menu"], [role="dialog"], [role="presentation"], [role="group"], [role="listbox"], [data-slot="scroll-area"], [data-slot="input-group-addon"], svg')) continue;
      if (el.matches(":disabled, [aria-disabled='true'], [data-disabled]")) continue;
      if (el.getClientRects().length === 0) continue; // not rendered
      const propsKey = Object.keys(el).find((k) => k.startsWith("__reactProps"));
      const props = propsKey ? ((el as unknown as Record<string, Record<string, unknown>>)[propsKey] ?? {}) : {};
      const handler = typeof props.onClick === "function" || typeof props.onPointerDown === "function" || typeof props.onMouseDown === "function";
      if (!handler && !el.matches(selector)) continue;
      const cursor = getComputedStyle(el).cursor;
      if (ALLOWED.has(cursor)) continue;
      out.add(`${describe(el)} → cursor:${cursor}`);
    }
    return Array.from(out).sort();
  }, INTERACTIVE);
}

async function audit(page: Page, label: string) {
  const list = await offenders(page);
  expect.soft(list, `${label}: clickables without cursor:pointer`).toEqual([]);
}

test.describe("cursor: pointer on every clickable", () => {
  test.skip(({ isMobile }) => isMobile, "a pointer-device concern");
  test("pages, tabs, menus and dialogs", async ({ page }) => {
    await page.goto("/");
    await audit(page, "inbox");
    await page.getByRole("button", { name: /^Signed in as/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await audit(page, "inbox · account menu");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0); // menus animate out; wait before opening the next
    await page.getByRole("button", { name: /^Workspace: / }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await audit(page, "inbox · workspace menu");
    await page.keyboard.press("Escape");

    await page.goto("/library");
    await audit(page, "library");
    await page.getByRole("combobox", { name: /namespace/i }).first().click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await audit(page, "library · namespace select");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);

    const video = await readyItem((i) => i.sourceType === "youtube_video");
    await page.goto(`/items/${video.id}`);
    await audit(page, "item · reader");
    for (const tab of ["Chat", "Transcript"]) {
      await page.getByRole("tab", { name: tab }).click();
      await audit(page, `item · ${tab.toLowerCase()}`);
    }
    const podcast = await readyItem((i) => i.sourceType === "podcast_episode", "english");
    await page.goto(`/items/${podcast.id}?tab=language`);
    await audit(page, "item · language");
    await page.goto(`/items/${video.id}/read`);
    await audit(page, "shared read page");

    await page.goto("/namespaces/demo/chat");
    await audit(page, "namespace chat");
    await page.goto("/namespaces/demo/graph");
    await audit(page, "namespace graph");
    await page.goto("/graph");
    await audit(page, "graph");
    await page.goto("/review");
    await audit(page, "practice");

    await page.goto("/settings");
    await audit(page, "settings");
    await page.getByRole("combobox", { name: /^Role of / }).first().click();
    await expect(page.getByRole("listbox")).toBeVisible();
    await audit(page, "settings · role select");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await page.getByRole("button", { name: /^Delete / }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await audit(page, "settings · delete dialog");
    await page.getByRole("button", { name: "Keep it" }).click();
  });

  test.describe("signed out", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    test("login and sign-up", async ({ page }) => {
      await page.goto("/login");
      await audit(page, "login");
      await page.goto("/signup");
      await audit(page, "signup");
    });
  });
});
