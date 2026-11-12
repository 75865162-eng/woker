import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "listing-attribute-recovery.spec.ts", outputDir: "../../tmp/listing-attribute-recovery-results", timeout: 20000, fullyParallel: false, reporter: "list", use: { headless: true, launchOptions: { args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] } } });
