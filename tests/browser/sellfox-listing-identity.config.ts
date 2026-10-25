import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "sellfox-listing-identity.spec.ts", outputDir: "/tmp/sellfox-listing-identity-results", reporter: "list", use: { headless: true } });
