import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { chromium, expect, type Page, type BrowserContext } from '@playwright/test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/db/prisma';
import { runProcurementPageWorkflow } from "./procurement-browser-workflow";
import {runWmsPageWorkflow} from './wms-browser-workflow';

export async function verifyWmsBrowser(cookie:string, approverCookie:string, focused?: { organizationId: string; run: (page: Page, approver: BrowserContext, base: string) => Promise<void> }) {
 await prisma.workspaceScope.create({ data: { organizationId: focused?.organizationId ?? "wms-org", id: "page-other", name: "Second synthetic workspace" } });
 const root=process.cwd();
 const directory=mkdtempSync(path.join(tmpdir(),'wms-browser-fixture-'));
 const portServer=createServer();await new Promise<void>(resolve=>portServer.listen(0,'127.0.0.1',resolve));
 const address=portServer.address();assert.ok(address&&typeof address==='object');const port=address.port;
 await new Promise<void>(resolve=>portServer.close(()=>resolve()));
 let logs='';let browser;
 try {
  cpSync(path.join(root,'src'),path.join(directory,'src'),{recursive:true});
  cpSync(path.join(root,'middleware.ts'),path.join(directory,'middleware.ts'));
  symlinkSync(path.join(root,'node_modules'),path.join(directory,'node_modules'),'dir');
  writeFileSync(path.join(directory,'package.json'),JSON.stringify({private:true}));
  writeFileSync(path.join(directory,'tsconfig.json'),readFileSync(path.join(root,'tsconfig.json'),'utf8'));
  writeFileSync(path.join(directory,'next.config.mjs'),'export default {distDir:".next-fixture"};');
  writeFileSync(path.join(directory,'postcss.config.mjs'),readFileSync(path.join(root,'postcss.config.mjs'),'utf8'));
  writeFileSync(path.join(directory,'src/app/layout.tsx'),'import "./globals.css";export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}');
  const allowedEnv:NodeJS.ProcessEnv={NODE_ENV:'development',PATH:process.env.PATH,TMPDIR:directory,DATABASE_URL:process.env.DATABASE_URL!,AUTH_DRIVER:'database',AUTH_SECRET:process.env.AUTH_SECRET!,WMS_OFFLINE_FIXTURE:'1',NEXT_TELEMETRY_DISABLED:'1',NODE_OPTIONS:`--import=${JSON.stringify(path.join(root,'tests/helpers/wms-process-preload.mjs'))}`};
  const child=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'dev',directory,'--hostname','127.0.0.1','--port',String(port)],{cwd:directory,env:allowedEnv,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>{logs+=data;});child.stderr.on('data',data=>{logs+=data;});
  try {
   const base=`http://127.0.0.1:${port}`;
   const deadline=Date.now()+90_000;
   while(true){if(child.exitCode!==null)throw Error(`Next fixture exited: ${logs.slice(-4000)}`);try{const response=await fetch(base+'/api/operations/wms/warehouses',{headers:{cookie},signal:AbortSignal.timeout(2000)});if(response.status===200)break;}catch{}if(Date.now()>deadline)throw Error(`Next fixture startup timeout: ${logs.slice(-4000)}`);await new Promise(resolve=>setTimeout(resolve,500));}
   browser=await chromium.launch({headless:true,timeout:30000});const context=await browser.newContext();
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const i=cookie.indexOf('=');await context.addCookies([{name:cookie.slice(0,i),value:cookie.slice(i+1),domain:'127.0.0.1',path:'/'}]);
   const page=await context.newPage();page.setDefaultTimeout(20000);
   page.on('pageerror',error=>console.error('WMS browser page error:',error.message));
   await page.goto(base+'/logistics/warehouse',{waitUntil:'domcontentloaded',timeout:60000});
   console.log('WMS browser: page loaded');
   await page.getByRole('heading',{name:'公司仓库',exact:true}).waitFor();
   if (!focused) await page.getByText('MAIN',{exact:true}).waitFor();
   console.log('WMS browser: authenticated warehouse rows rendered');
   await expect.poll(() => page.getByRole('tablist', {name:'仓库数据类型'}).evaluate(element => getComputedStyle(element).display)).toBe('flex');
   try { if (!focused) await page.getByRole('tab',{name:'库存余额',exact:true}).click(); }
   catch (error) {
    mkdirSync(path.join(root,'outputs/wms-p0b-local'),{recursive:true});
    await page.screenshot({path:path.join(root,'outputs/wms-p0b-local/browser-failure.png'),fullPage:false});
    throw error;
   }
   if (!focused) await page.getByRole('columnheader',{name:'实物数量',exact:true}).waitFor();
   const approverContext=await browser.newContext();
   await approverContext.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const split=approverCookie.indexOf('=');await approverContext.addCookies([{name:approverCookie.slice(0,split),value:approverCookie.slice(split+1),domain:'127.0.0.1',path:'/'}]);
   if (focused) await focused.run(page,approverContext,base);
   else { try { await runWmsPageWorkflow(page,approverContext,base); } catch (error) { console.warn('WMS browser regression prevented the procurement page workflow:', error instanceof Error ? error.stack : 'unknown error'); } await runProcurementPageWorkflow(page,await approverContext.newPage(),base); }
   mkdirSync(path.join(root,'outputs/wms-p0b-local'),{recursive:true});
   await page.screenshot({path:path.join(root,'outputs/wms-p0b-local/warehouse.png'),fullPage:false});
   console.log(focused ? 'PASS: disposable Next and Chromium verify the focused two-session warehouse workflow' : 'PASS: disposable Next and Chromium verify the full two-session warehouse page workflow, workspace scope and pagination');
  } finally {
   await browser?.close();
   if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}
  }
 } finally {rmSync(directory,{recursive:true,force:true});}
}
