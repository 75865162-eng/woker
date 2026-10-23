import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: "../../tmp/operations-test-results",
  testDir: ".", testMatch: "operations.spec.ts", timeout: 30_000,
  fullyParallel: false, reporter: "list", use: { headless: true },
});
