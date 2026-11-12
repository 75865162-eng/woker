import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'wms-overseas-charges.spec.ts',outputDir:'../../tmp/wms-overseas-charges-results',timeout:30000,reporter:'list',use:{headless:true}});
