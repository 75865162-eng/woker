import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'wms-risk.spec.ts',outputDir:'../../tmp/wms-risk-results',timeout:30000,reporter:'list',use:{headless:true}});
