import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'.',testMatch:'three-core-port.spec.ts',outputDir:'../../tmp/three-core-port-results',timeout:30000,reporter:'list',use:{headless:true,viewport:{width:1440,height:1000}}});
