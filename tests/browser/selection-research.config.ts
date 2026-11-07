import { defineConfig } from "@playwright/test";
export default defineConfig({ outputDir: "../../tmp/selection-research-browser", testDir: ".", testMatch: "selection-research.spec.ts", timeout: 30_000, fullyParallel: false, reporter: "list", use: { headless: true } });
