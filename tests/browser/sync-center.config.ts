import { defineConfig } from "@playwright/test";
export default defineConfig({ outputDir: "../../tmp/sync-center-test-results", testDir: ".", testMatch: /(?:sync-center|amazon-sp-api-settings|amazon-multistore)\.spec\.ts/, timeout: 30000, fullyParallel: false, reporter: "list", use: { headless: true } });
