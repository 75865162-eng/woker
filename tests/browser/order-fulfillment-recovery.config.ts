import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "order-fulfillment-recovery.spec.ts", outputDir: "../../tmp/order-fulfillment-recovery-results", timeout: 20000, fullyParallel: false, reporter: "list", use: { headless: true, launchOptions: { args: ["--disable-background-networking", "--disable-component-update", "--no-first-run"] } } });
