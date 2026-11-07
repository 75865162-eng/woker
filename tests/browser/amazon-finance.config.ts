import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "amazon-finance.spec.ts", outputDir: "../../tmp/finance-test-results", timeout: 20000, fullyParallel: false, reporter: "list", use: { headless: true, launchOptions: { args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] } } });
