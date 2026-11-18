import { defineConfig } from "@playwright/test";
export default defineConfig({ outputDir: "../../tmp/amazon-sync-matrix-test-results", testDir: ".", testMatch: /amazon-sync-matrix\.spec\.ts/, timeout: 30000, fullyParallel: false, reporter: "list", use: { headless: true } });
