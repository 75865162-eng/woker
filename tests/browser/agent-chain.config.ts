import { defineConfig } from "@playwright/test";

export default defineConfig({
  outputDir: "../../tmp/agent-chain-test-results", testDir: ".", testMatch: "agent-chain.spec.ts",
  timeout: 45_000, fullyParallel: false, reporter: "list", use: { headless: true },
});
