import { defineConfig } from "@playwright/test";
export default defineConfig({ outputDir: "../../tmp/sync-center-test-results", testDir: ".", testMatch: "sync-center.spec.ts", timeout: 30000, fullyParallel: false, reporter: "list", use: { headless: true } });
