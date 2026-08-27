import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// End-to-end tests drive the real web app against the real API server in MARROW_FAKE mode (fake pipeline, scripted
// chat, seeded corpus in a throw-away PGlite + local storage) — no network, no OpenAI, no yt-dlp.
// Playwright loads this file as CommonJS: resolve paths from the package directory (`bun run e2e` runs in apps/web).
const here = resolve(process.cwd().endsWith("apps/web") ? process.cwd() : join(process.cwd(), "apps", "web"));
const root = join(here, "..", "..");
const tmp = process.env.E2E_TMP ?? mkdtempSync(join(tmpdir(), "marrow-e2e-"));
const API = Number(process.env.E2E_API_PORT ?? 3101);
const WEB = Number(process.env.E2E_WEB_PORT ?? 3100);
const KEY = "e2e-key";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],
  use: { baseURL: `http://localhost:${WEB}`, trace: "retain-on-failure", screenshot: "only-on-failure", video: "off" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 900 } }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "bun run apps/server/src/index.ts",
      cwd: root,
      port: API,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: {
        MARROW_FAKE: "1",
        PORT: String(API),
        STORAGE_DRIVER: "local",
        PGLITE_DIR: join(tmp, "pglite"),
        LOCAL_STORAGE_DIR: join(tmp, "storage"),
        WORK_DIR: join(tmp, "work"),
        POLL_EVERY_MINUTES: "0",
        MARROW_API_KEY: KEY,
        OPENAI_API_KEY: "test",
      },
    },
    {
      command: process.env.CI ? `bun run build && bun run start -- -p ${WEB}` : `bun run dev -- -p ${WEB}`,
      cwd: here,
      port: WEB,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: { MARROW_API_URL: `http://localhost:${API}`, MARROW_API_KEY: KEY, NEXT_PUBLIC_SITE_URL: `http://localhost:${WEB}` },
    },
  ],
});
