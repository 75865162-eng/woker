import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '.',
  testMatch: 'wimoor-feature-layout.spec.ts',
  outputDir: '../../tmp/wimoor-feature-layout-results',
  timeout: 30000,
  fullyParallel: false,
  reporter: 'list',
  use: { headless: true, viewport: { width: 1440, height: 1000 } },
});
