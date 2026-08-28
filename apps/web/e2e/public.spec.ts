import { expect, readyItem, test } from "./helpers";

// Share pages are public and indexable; the rest of the app is not.
test.describe("public share page", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("opens without signing in, with title, canonical, index robots, structured data and a working OG image", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    const res = await page.goto(`/items/${video.id}/read`);
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/items/${video.id}/read$`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(video.title);
    await expect(page).toHaveTitle(new RegExp(video.title.slice(0, 20)));
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/items/${video.id}/read$`));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
    await expect(page.locator('meta[name="robots"]')).not.toHaveAttribute("content", /noindex/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", new RegExp(video.title.slice(0, 20)));
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(1);
    const ld = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld ?? "{}")).toMatchObject({ "@context": "https://schema.org", "@type": "VideoObject", name: video.title });
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    // the app chrome is not there
    await expect(page.getByRole("link", { name: "Inbox" })).toHaveCount(0);

    // Next serves file-based OG images at a hashed URL — fetch exactly what the page advertises.
    const ogUrl = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(ogUrl).toMatch(new RegExp(`/items/${video.id}/read/opengraph-image`));
    const og = await page.request.get(ogUrl!);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
  });

  test("podcast audio, exports and read events go through the public proxy without a session", async ({ page }) => {
    const pod = await readyItem((i) => i.sourceType === "podcast_episode");
    await page.goto(`/items/${pod.id}/read`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(pod.title);
    const audio = await page.request.get(`/api/marrow/public/items/${pod.id}/audio`, { headers: { range: "bytes=0-99" } });
    expect([200, 206]).toContain(audio.status());
    expect((await page.request.get(`/api/marrow/public/items/${pod.id}/export.md`)).status()).toBe(200);
    expect((await page.request.post(`/api/marrow/public/items/${pod.id}/events`)).status()).toBe(200);
    // …but the signed-in proxy still refuses
    expect((await page.request.get(`/api/marrow/items/${pod.id}`)).status()).toBe(401);
  });

  test("sitemap and robots point search engines at share pages only", async ({ page }) => {
    const video = await readyItem((i) => i.sourceType === "youtube_video");
    const sitemap = await page.request.get("/sitemap.xml");
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain(`/items/${video.id}/read`);
    const robots = await page.request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    const txt = await robots.text();
    expect(txt).toMatch(/Allow: \/items\/\*\/read/);
    expect(txt).toMatch(/Disallow: \//);
    expect(txt).toMatch(/Sitemap: .*\/sitemap\.xml/);
    // the app pages are still gated and noindex
    await page.goto(`/items/${video.id}`);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.goto("/login");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
    await expect(page).toHaveTitle(/Marrow — talks/);
  });
});
