import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "apps/web/lib/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
