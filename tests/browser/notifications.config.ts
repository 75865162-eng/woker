import { defineConfig } from "@playwright/test";
export default defineConfig({
  outputDir: "../../tmp/notification-test-results", testDir: ".", testMatch: "notifications.spec.ts",
  timeout: 30_000, fullyParallel: false, reporter: "list", use: { headless: true },
});
