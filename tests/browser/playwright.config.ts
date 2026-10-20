import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: "../../tmp/product-edit-test-results",
  testDir: ".", testMatch: "product-edit.spec.ts", timeout: 60_000,
  fullyParallel: false, reporter: "list", use: { headless: true },
});
