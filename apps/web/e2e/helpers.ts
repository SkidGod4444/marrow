import { type Page, expect, test as base } from "@playwright/test";

/** Anything the browser logs as an error (uncaught exceptions, console.error incl. React hydration warnings). */
export type Errors = { list: string[] };

const IGNORE = [/favicon/i, /youtube\.com|ytimg\.com|googlevideo/i, /net::ERR_(BLOCKED|ABORTED)/i, /Download the React DevTools/i, /\[Fast Refresh\]/i, /Failed to load resource: the server responded with a status of 4\d\d/i];

export function watchErrors(page: Page): Errors {
  const errors: Errors = { list: [] };
  page.on("pageerror", (e) => errors.list.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error" && m.type() !== "warning") return;
    const text = m.text();
    if (m.type() === "warning" && !/hydrat|Each child in a list|act\(|Warning:/i.test(text)) return;
    if (IGNORE.some((r) => r.test(text))) return;
    errors.list.push(`${m.type()}: ${text.slice(0, 300)}`);
  });
  return errors;
}

/** Every test gets error tracking for free; the fixture asserts nothing leaked at the end. */
export const test = base.extend<{ errors: Errors }>({
  errors: [
    async ({ page }, use) => {
      const errors = watchErrors(page);
      await use(errors);
      expect.soft(errors.list, "no browser errors during the test").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

export const API = process.env.E2E_API_URL ?? "http://localhost:3101";
/** Per-run suffix so tests that add things stay idempotent against a reused stack. */
export const RUN = String(Date.now()).slice(-6);
/** The instance key; it names the workspace it acts in with `x-marrow-org`. */
export const KEY = "e2e-key";

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { "x-api-key": KEY, "x-marrow-org": "demo-lab", "content-type": "application/json", ...init.headers } });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export type ItemRow = { id: string; title: string; sourceType: string; status: string; sourceUrl: string; namespaceId: string };
export async function items(namespace = "demo"): Promise<ItemRow[]> {
  return (await api<{ items: ItemRow[] }>(`/items?namespace=${namespace}`)).items;
}
export async function readyItem(pred: (i: ItemRow) => boolean, namespace = "demo"): Promise<ItemRow> {
  const it = (await items(namespace)).find((i) => i.status === "ready" && pred(i));
  if (!it) throw new Error("no matching ready item in the fake corpus");
  return it;
}

/** The page body must never scroll sideways (owner rule: responsive everywhere). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow (px)").toBeLessThanOrEqual(1);
}
