import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'fba-customs.spec.ts',outputDir:'../../tmp/fba-customs-results',timeout:30000,reporter:'list',use:{headless:true}});
