import { defineConfig } from "@playwright/test";
export default defineConfig({ outputDir: "/tmp/sellfox-hub-browser-results", testDir: ".", testMatch: "sellfox-hub.spec.ts", timeout: 30_000, fullyParallel: false, reporter: "list", use: { headless: true } });
