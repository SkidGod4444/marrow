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
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/research brain/i);
    await expect(page.locator('section[aria-labelledby="thesis"] canvas')).toHaveCount(1); // the brain, turning behind the words
    await expect(page.getByRole("link", { name: /grow your research brain/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/); // the site root
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "[]") as Array<{ "@type": string }>;
    expect(ld.map((x) => x["@type"]).sort()).toEqual(["SoftwareApplication", "WebSite"]);
    await expect(page).toHaveTitle(/Marrow — a research brain/);

    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    // /welcome is only the internal address: typed directly, it goes to "/"; the sitemap and robots know the front door
    const direct = await page.request.get("/welcome");
    expect(direct.url()).toMatch(/\/$/);
    expect(await (await page.request.get("/sitemap.xml")).text()).toMatch(/<loc>[^<]*\/<\/loc>/);
    expect(await (await page.request.get("/robots.txt")).text()).toMatch(/Allow: \/\$/);
  });
});

test("a stale session cookie still gets the landing, not a sign-in bounce", async ({ browser }) => {
  const ctx = await browser.newContext({
    storageState: { cookies: [{ name: "better-auth.session_token", value: "stale.stale", domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }], origins: [] },
  });
  const page = await ctx.newPage();
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/research brain/i);
  expect((await ctx.cookies()).some((c) => c.name.endsWith("session_token"))).toBe(false); // and the dead cookie is cleared
  await ctx.close();
});

test("signed in, \"/\" is still the inbox", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/inbox|turn a video/i);
});
