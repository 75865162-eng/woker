import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "amazon-ads-decision.spec.ts", outputDir: "../../tmp/amazon-ads-decision-test-results", timeout: 30_000, fullyParallel: false, reporter: "list", use: { headless: true, viewport: { width: 1280, height: 900 } } });
