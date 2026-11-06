import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: ["amazon-ads.spec.ts", "amazon-ads-campaigns.spec.ts"], outputDir: "../../tmp/amazon-ads-test-results", timeout: 30_000, fullyParallel: false, reporter: "list", use: { headless: true, viewport: { width: 1440, height: 1000 } } });
