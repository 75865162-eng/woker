import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'management-port.spec.ts', outputDir: '../../tmp/management-port-results', timeout: 30000, fullyParallel: false, reporter: 'list', use: { headless: true } });
