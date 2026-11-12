import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/db/prisma';
import { verifyFinanceSourceBrowser } from './finance-source-browser.integration';
import { verifyBrowserCustomsFinance } from './fba-customs-finance-browser.integration';
import { seedShipmentObservation } from './fba-shipment-link.integration';

export async function verifyFbaLocalBrowser(cookie:string, approverCookie:string) {

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
   const page=await context.newPage();page.setDefaultTimeout(60000);
   page.on('pageerror',error=>console.error('WMS browser page error:',error.message));
   async function openPlans(target: typeof page) {
    await target.goto(base+'/operations?view=first-mile',{waitUntil:'domcontentloaded',timeout:60000});
    try { await target.getByLabel('店铺',{exact:true}).selectOption('seller'); } catch(error) { console.error('FBA page:',target.url(),await target.locator('body').innerText(),logs.slice(-6000)); throw error; }
    await target.getByLabel('站点',{exact:true}).selectOption('SITE');
    await target.getByRole('heading',{name:'FBA 本地发货计划',exact:true}).waitFor();
   }
   await openPlans(page);
   await page.getByRole('button',{name:'新建本地计划',exact:true}).click();
   await page.getByLabel('计划单号',{exact:true}).fill('BROWSER-CORE');
   const stockRows=page.getByRole('dialog').getByRole('row');
   await stockRows.filter({has:page.getByText('库位：S',{exact:true})}).getByRole('spinbutton').fill('2');
   await stockRows.filter({has:page.getByText('库位：S2',{exact:true})}).getByRole('spinbutton').fill('1');
   await page.getByRole('button',{name:'保存本地计划',exact:true}).click();
   const card=page.locator('article').filter({has:page.getByText('BROWSER-CORE',{exact:true})});
   await card.waitFor();
   await seedShipmentObservation({organizationId:'fba-fixture',workspaceId:'default',actorUserId:'operator'},'browser-observation','BROWSER-AMAZON',[2,1]);
   await card.getByRole('button',{name:'关联已同步货件',exact:true}).click();
   const shipmentForm=page.getByRole('form',{name:'货件明细映射',exact:true});
   await shipmentForm.getByLabel('Amazon 货件 ID',{exact:true}).fill('BROWSER-AMAZON');
   await shipmentForm.getByRole('button',{name:'读取已同步货件',exact:true}).click();
   await expect(shipmentForm).toContainText('2 条来源商品行');
   const mappedPlan=await prisma.fbaLocalPlan.findFirstOrThrow({where:{number:'BROWSER-CORE'},include:{lines:{orderBy:{id:'asc'}}}});
   await shipmentForm.getByLabel('映射1本地明细',{exact:true}).selectOption(mappedPlan.lines.find(line=>line.quantity===2)!.id);
   await shipmentForm.getByLabel('映射2本地明细',{exact:true}).selectOption(mappedPlan.lines.find(line=>line.quantity===1)!.id);
   await shipmentForm.getByLabel('人工核对依据',{exact:true}).fill('Synthetic pick list checked by source occurrence and local lot');
   await shipmentForm.getByRole('button',{name:'保存货件关联',exact:true}).click();
   await expect(card.getByLabel('Amazon 货件关联')).toContainText('BROWSER-AMAZON');
   await openPlans(page);
   await expect(card.getByLabel('Amazon 货件关联')).toContainText('FN-SYNTHETIC');
   const linkedShipment=await prisma.fbaLocalShipment.findFirstOrThrow({where:{planId:mappedPlan.id},include:{items:true}});
   assert.equal(linkedShipment.sourceRunId,'browser-observation');assert.equal(linkedShipment.items.reduce((sum,row)=>sum+row.quantity,0),3);
   console.log('PASS: browser previews a published Amazon shipment and explicitly maps both source occurrences to local lots with persistent provenance');
   await card.getByRole('button',{name:'填写费用分摊',exact:true}).click();
   const costForm=page.getByRole('form',{name:'头程费用分摊',exact:true});
   await costForm.getByLabel('费用来源单号',{exact:true}).fill('BROWSER-FEE');
   await costForm.getByLabel('费用金额',{exact:true}).fill('100');
   await costForm.getByLabel('币种',{exact:true}).fill('USD');
   await costForm.getByRole('button',{name:'计算并保存费用草稿',exact:true}).click();
   await expect(card.getByLabel('计划费用分摊')).toContainText('USD 100.000000');
   await openPlans(page);
   await expect(card.getByLabel('计划费用分摊')).toContainText('BROWSER-FEE');
   await card.getByRole('button',{name:'新建货代委托',exact:true}).click();
   const transportForm=page.getByRole('form',{name:'货代委托录入',exact:true});
   for(const [label,value]of[['委托单号','BROWSER-FWD'],['货代','Synthetic carrier'],['运输渠道','Ocean LCL'],['目的地址','Synthetic destination'],['柜号','CONT-BROWSER'],['提单号','BOL-BROWSER'],['船名航次/航班','V001']])await transportForm.getByLabel(label,{exact:true}).fill(value);
   await transportForm.getByRole('button',{name:'保存货代委托',exact:true}).click();
   const transportPanel=card.getByLabel('货代委托与物流轨迹');
   await expect(transportPanel).toContainText('BROWSER-FWD');
   await openPlans(page);
   await expect(transportPanel).toContainText('BOL-BROWSER');
   await card.getByRole('button',{name:'新增独立费用',exact:true}).click();
   await costForm.getByLabel('费用编号',{exact:true}).fill('BROWSER-OCEAN');
   await costForm.getByLabel('费用来源单号',{exact:true}).fill('BROWSER-QUOTE');
   await costForm.getByLabel('费用金额',{exact:true}).fill('100');
   await costForm.getByLabel('币种',{exact:true}).fill('USD');
   await costForm.getByRole('button',{name:'保存费用预估',exact:true}).click();
   const ledger=card.getByLabel('费用台账与货代对账');
   await expect(ledger).toContainText('BROWSER-OCEAN');
   await ledger.getByRole('button',{name:'确认货代账单',exact:true}).click();
   await costForm.getByLabel('货代账单号',{exact:true}).fill('BROWSER-BILL');
   await costForm.getByLabel('货代',{exact:true}).fill('Synthetic carrier');
   await costForm.getByRole('checkbox',{name:/关联委托单 BROWSER-FWD/}).check();
   await costForm.getByLabel('费用金额',{exact:true}).fill('110');
   await costForm.getByRole('button',{name:'确认账单并对账',exact:true}).click();
   await expect(ledger).toContainText('差额 10.000000');
   await expect(ledger).toContainText('待核算主体、科目及期间映射');
   await openPlans(page);
   await expect(ledger).toContainText('BROWSER-BILL');
   const linkedOrder=await prisma.fbaLocalForwarderOrder.findFirstOrThrow({where:{number:'BROWSER-FWD'}});
   assert.equal((await prisma.fbaLocalForwarderBill.findFirstOrThrow({where:{number:'BROWSER-BILL'}})).forwarderOrderId,linkedOrder.id);
   await expect(ledger.getByRole('button',{name:'确认货代账单',exact:true})).toHaveCount(0);
   console.log('PASS: browser fee estimate → actual forwarder bill → scoped reconciliation and adjustment handoff persists after reload');
   await card.getByRole('button',{name:'填写装箱资料',exact:true}).click();
   const packingForm=page.getByRole('form',{name:'本地装箱资料',exact:true});
   for (const [label,value] of [['箱号','BROWSER-BOX'],['长（厘米）','30'],['宽（厘米）','20'],['高（厘米）','10'],['毛重（千克）','2.5']]) await packingForm.getByLabel(`第1箱${label}`,{exact:true}).fill(value);
   const packingPlan=await prisma.fbaLocalPlan.findFirstOrThrow({where:{number:'BROWSER-CORE'},include:{lines:{orderBy:{id:'asc'}}}});
   for (const [index,line] of packingPlan.lines.entries()) await packingForm.getByLabel(`第1箱明细${index+1}数量`,{exact:true}).fill(String(line.quantity));
   await packingForm.getByRole('button',{name:'保存装箱资料',exact:true}).click();
   await expect(card.getByLabel('计划装箱资料')).toContainText('箱号 BROWSER-BOX');
   await openPlans(page);
   await expect(card.getByLabel('计划装箱资料')).toContainText('30 × 20 × 10 cm · 毛重 2.5 kg · 3 件');
   await verifyBrowserCustomsFinance(page,card);
   // Wimoor UI port: actual App Router and persisted packing, with the same scoped service.
   const evidenceDir=path.join(root,'docs/wimoor-integration/ui/2026-11-12/screenshots');
   mkdirSync(evidenceDir,{recursive:true});
   await page.getByRole('button',{name:'打开业务菜单',exact:true}).click();
   const businessMenu=page.getByRole('dialog',{name:'业务菜单',exact:true});
   await page.screenshot({path:path.join(evidenceDir,'business-navigation-next-fixture.png'),fullPage:false});
   await businessMenu.getByRole('link',{name:'FBA 装箱',exact:true}).click();
   await page.waitForURL(base+'/operations?view=fba-boxing');
   await page.reload({waitUntil:'domcontentloaded'});
   await page.getByLabel('店铺',{exact:true}).selectOption('seller');
   await page.getByLabel('站点',{exact:true}).selectOption('SITE');
   const packingRow=page.getByRole('table',{name:'本地计划装箱列表'}).getByRole('row').filter({has:page.getByText('BROWSER-CORE',{exact:true})});
   await expect(packingRow).toContainText('1 箱 · 本地已保存');
   await page.screenshot({path:path.join(evidenceDir,'fba-packing-next-fixture.png'),fullPage:false});
   await packingRow.getByRole('button',{name:'装箱详情',exact:true}).click();
   const packingDrawer=page.getByRole('dialog',{name:'本地计划与装箱详情',exact:true});
   await expect(packingDrawer).toContainText('箱号 BROWSER-BOX');
   await page.screenshot({path:path.join(evidenceDir,'fba-packing-detail-next-fixture.png'),fullPage:false});
   await packingDrawer.getByRole('button',{name:'关闭弹窗',exact:true}).first().click();
   await openPlans(page);
   console.log('PASS: business menu → packing App Router refresh → persisted box table/detail → existing plan page');
   await card.getByRole('button',{name:'申请全部待预占（2 条）',exact:true}).click();
   await expect(card).toContainText('待主管审批');
   await openPlans(page);
   await expect(card).toContainText('待主管审批');
   await expect(card.getByRole('button',{name:'批准预占',exact:true})).toHaveCount(0);
   const approverContext=await browser.newContext();
   await approverContext.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   const split=approverCookie.indexOf('=');await approverContext.addCookies([{name:approverCookie.slice(0,split),value:approverCookie.slice(split+1),domain:'127.0.0.1',path:'/'}]);
   const approver=await approverContext.newPage();approver.setDefaultTimeout(60000);
   await openPlans(approver);
   const supervisorCard=approver.locator('article').filter({has:approver.getByText('BROWSER-CORE',{exact:true})});
   await supervisorCard.getByRole('button',{name:'批准本计划待审明细（2 条）',exact:true}).click();
   await expect(supervisorCard).toContainText('已批准待执行',{timeout:30000});
   const pendingPlan=await prisma.fbaLocalPlan.findFirstOrThrow({where:{number:'BROWSER-CORE'},include:{lines:true}});
   const pendingApproval=await prisma.wmsApproval.findFirstOrThrow({where:{status:'APPROVED',request:{path:['payload','number'],equals:`FBA-LOCAL:${pendingPlan.lines[0].id}`}}});
   await page.goto(base+'/logistics/warehouse?tab=approvals',{waitUntil:'domcontentloaded',timeout:60000});
   const pendingRow=page.locator(`tr[data-record-id="${pendingApproval.id}"]`);
   await expect(pendingRow.getByRole('button',{name:'执行',exact:true})).toHaveCount(0);
   await pendingRow.getByRole('link',{name:'查看头程计划并执行',exact:true}).click();
   await expect(page).toHaveURL(/view=first-mile&lineId=/);
   await expect(page.getByRole('article')).toHaveCount(1);
   await expect(page.getByLabel('店铺',{exact:true})).toHaveCount(0);
   await card.getByRole('button',{name:'执行全部已批预占（2 条）',exact:true}).click();
   await expect(card).toContainText('库存已就绪');
   const plan=await prisma.fbaLocalPlan.findFirstOrThrow({where:{number:'BROWSER-CORE'},include:{lines:true}});
   const planReservations=await prisma.wmsReservation.findMany({where:{id:{in:plan.lines.map(line=>line.reservationId!)}}});
   let reservation=planReservations.find(row=>row.requestedQty===2)!;
   const firstLine=plan.lines.find(line=>line.reservationId===reservation.id)!;
   assert.equal(reservation.requestedQty,2);
   await card.locator(`tr[data-plan-line-id="${firstLine.id}"]`).getByRole('link',{name:'仓库拣货与出库',exact:true}).click();
   await expect(page).toHaveURL(/tab=reservations&number=FBA-LOCAL/);
   await page.getByText(`FBA-LOCAL:${firstLine.id}`,{exact:true}).first().waitFor();
   const warehouseRow=()=>page.locator(`tr[data-record-id="${reservation.id}"]`);
   async function post(target: typeof page, resource: string, click: () => Promise<void>) {
    const pending=target.waitForResponse(response=>new URL(response.url()).pathname.endsWith(`/wms/${resource}`)&&response.request().method()==='POST');
    await click();const response=await pending;const body=await response.json();assert.ok(response.ok(),JSON.stringify(body));return body.item;
   }
   async function warehouseAction(name: string, approvalRequired: boolean) {
    await warehouseRow().getByRole('button',{name,exact:true}).click();
    const form=page.getByRole('form',{name:`${name}作业`,exact:true});
    await form.getByLabel(`${name}数量`,{exact:true}).fill('1');
    const result=await post(page,approvalRequired?'approvals':'commands',()=>form.getByRole('button',{name:`${approvalRequired?'申请':'确认'}${name}`,exact:true}).click());
    if(approvalRequired){
     await approver.goto(base+'/logistics/warehouse?tab=approvals',{waitUntil:'domcontentloaded',timeout:60000});
     const approvalRow=approver.locator(`tr[data-record-id="${result.id}"]`);
     await post(approver,'approvals',()=>approvalRow.getByRole('button',{name:'通过审批',exact:true}).click());
     await page.getByRole('button',{name:'刷新',exact:true}).click();
     await post(page,'commands',()=>page.locator(`tr[data-record-id="${result.id}"]`).getByRole('button',{name:'执行',exact:true}).click());
    }
   }
   async function verifyProgress(text: string) {
    await page.goto(base+'/logistics/warehouse?tab=reservations&number='+encodeURIComponent(reservation.number),{waitUntil:'domcontentloaded',timeout:60000});
    await warehouseRow().getByRole('link',{name:'查看头程计划',exact:true}).click();
    await expect(page).toHaveURL(/view=first-mile&lineId=/);
    await expect(card.getByLabel('计划出库进度')).toContainText(text);
    await expect(card.getByRole('button',{name:'取消计划',exact:true})).toHaveCount(0);
    await card.locator(`tr[data-plan-line-id="${firstLine.id}"]`).getByRole('link',{name:'仓库拣货与出库',exact:true}).click();
    await warehouseRow().waitFor();
   }
   await warehouseAction('拣货',false);
   await verifyProgress('待拣 2 · 已拣待出库 1 · 累计出库 0');
   await warehouseAction('出库',true);
   await verifyProgress('剩余预占 2 · 待拣 2 · 已拣待出库 0 · 累计出库 1');
   await warehouseAction('拣货',false);
   await warehouseAction('出库',true);
   await openPlans(page);
   await expect(card.locator(':scope > header')).toContainText('部分出库');
   await expect(card).toContainText('累计出库 2');
   await expect(card).toContainText('Amazon 收货状态尚未接入');
   await expect(card.getByRole('button',{name:'取消计划',exact:true})).toHaveCount(0);
   assert.equal((await prisma.wmsReservation.findUniqueOrThrow({where:{id:reservation.id}})).dispatchedQty,2);
   const secondReservation=planReservations.find(row=>row.requestedQty===1)!;
   const secondLine=plan.lines.find(line=>line.reservationId===secondReservation.id)!;
   reservation=secondReservation;
   await card.locator(`tr[data-plan-line-id="${secondLine.id}"]`).getByRole('link',{name:'仓库拣货与出库',exact:true}).click();
   await warehouseRow().waitFor();
   await warehouseAction('拣货',false);
   await warehouseAction('出库',true);
   await openPlans(page);
   await expect(card.locator(':scope > header')).toContainText('已出库');
   await expect(card).toContainText('累计出库 3');
   await expect(card.getByRole('button',{name:'修改装箱资料',exact:true})).toHaveCount(0);
   const lockedPacking=await page.request.post(base+'/api/operations/fba-local-plans',{headers:{'x-workspace-id':'default'},data:{action:'SAVE_PACKING',id:packingPlan.id,expectedRevision:4,packing:{boxes:[]}}});
   assert.equal(lockedPacking.status(),409);
   assert.equal(await prisma.wmsReservation.count({where:{id:{in:planReservations.map(row=>row.id)},dispatchedQty:{gt:0}}}),2);
   for(const [eventType,location,evidence,offset] of [['DEPARTED','Origin','Synthetic carrier dispatch',120000],['DELIVERED','Destination','Synthetic signed delivery',60000]] as const){
    await transportPanel.getByRole('button',{name:'追加物流节点',exact:true}).click();
    const tracking=page.getByRole('form',{name:'物流节点录入',exact:true});
    await tracking.getByLabel('物流节点',{exact:true}).selectOption(eventType);
    const when=new Date(Date.now()-offset);
    await tracking.getByLabel('发生时间',{exact:true}).fill(new Date(when.getTime()-when.getTimezoneOffset()*60000).toISOString().slice(0,16));
    await tracking.getByLabel('节点地点',{exact:true}).fill(location);
    await tracking.getByLabel('凭据或来源说明',{exact:true}).fill(evidence);
    await tracking.getByRole('button',{name:'保存物流节点',exact:true}).click();
    await expect(transportPanel).toContainText(evidence);
   }
   await openPlans(page);
   await expect(transportPanel).toContainText('货代已送达');
   await expect(transportPanel).toContainText('货代送达不代表 Amazon 已收货');
   await expect(transportPanel.getByRole('button',{name:'追加物流节点',exact:true})).toHaveCount(0);
   assert.equal((await prisma.fbaLocalForwarderOrder.findUniqueOrThrow({where:{id:linkedOrder.id}})).status,'DELIVERED');
   assert.equal(await prisma.fbaLocalTracking.count({where:{orderId:linkedOrder.id}}),2);
   console.log('PASS: browser forwarder order links actual bill, then physical dispatch → manual departure → delivery persists and locks terminal transport');
   await verifyFinanceSourceBrowser(page,base);
   console.log('PASS: multi-line bulk request/approve/execute refreshes revisions; two-session warehouse partial/full dispatch reconciles both lines');
  } finally {
   await browser?.close();
   if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,5000))]);if(child.exitCode===null)child.kill('SIGKILL');}
  }
 } finally {rmSync(directory,{recursive:true,force:true});}
}
