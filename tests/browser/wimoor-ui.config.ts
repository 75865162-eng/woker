import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'wimoor-ui.spec.ts', outputDir: '../../tmp/wimoor-ui-results', timeout: 30000, fullyParallel: false, reporter: 'list', use: { headless: true, viewport: { width: 1440, height: 1000 } } });
