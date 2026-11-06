import { defineConfig } from "@playwright/test";
export default defineConfig({ outputDir: "/tmp/sellfox-credentials-browser-results", testDir: ".", testMatch: "sellfox-credentials.spec.ts", timeout: 30_000, fullyParallel: false, reporter: "list", use: { headless: true } });
