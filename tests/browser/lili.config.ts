import { defineConfig } from "@playwright/test";
export default defineConfig({
  outputDir: "../../tmp/lili-browser-test-results", testDir: ".", testMatch: "lili.spec.ts",
  timeout: 45_000, fullyParallel: false, reporter: "list", use: { headless: true },
});
