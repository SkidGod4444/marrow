import AxeBuilder from "@axe-core/playwright";
import { expect, expectNoHorizontalOverflow, test } from "./helpers";

// The front door at "/": public and indexable for visitors, the inbox for the signed-in.
test.describe("landing page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("public, indexable, accessible, and fine on a phone", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // the reveal animation fades in from opacity 0; axe measures what it sees
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/$/); // rewritten, not redirected
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/marrow of every talk/i);
    await expect(page.getByRole("img", { name: /death of socrates/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /create an account/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /three ways/i })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/); // the site root
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "[]") as Array<{ "@type": string }>;
    expect(ld.map((x) => x["@type"]).sort()).toEqual(["SoftwareApplication", "WebSite"]);
    await expect(page).toHaveTitle(/Marrow — talks/);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // /welcome is the same page; the sitemap and robots know the front door
    expect((await page.request.get("/welcome")).status()).toBe(200);
    expect(await (await page.request.get("/sitemap.xml")).text()).toMatch(/<loc>[^<]*\/<\/loc>/);
    expect(await (await page.request.get("/robots.txt")).text()).toMatch(/Allow: \/\$/);
  });
});

test("signed in, \"/\" is still the inbox", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/inbox|turn a video/i);
});
