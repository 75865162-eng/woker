import { defineConfig } from '@playwright/test';
export default defineConfig({ outputDir: '../../tmp/calculator-test-results', testDir: '.', testMatch: 'calculator.spec.ts', timeout: 30000, reporter: 'list', use: { headless: true } });
