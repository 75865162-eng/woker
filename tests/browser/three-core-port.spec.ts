import ExcelJS from 'exceljs';
import {build} from 'esbuild';
import {test,expect,type Page} from '@playwright/test';
let bundle='';
test.beforeAll(async()=>{bundle=(await build({entryPoints:['tests/browser/three-core-port-harness.tsx'],bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env':'{"NODE_ENV":"development"}'}})).outputFiles[0].text;});
async function setup(page:Page){
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const calls:Record<string,unknown>[]=[];
 const book={id:'book',code:'FIXTURE',name:'Synthetic',currency:'USD',enabled:true,revision:1,closePolicy:{reference:'fixture-policy',requiredDomains:['PROCUREMENT','COST','FBA','AMAZON','ADS','BANK','SUBLEDGER','PROFIT_LOSS'],allowReopen:false}};
 const period={id:'period',bookId:'book',code:'2026-11',start:'2026-11-01',end:'2026-11-30',status:'OPEN',revision:2};
 const subjects=[{id:'ap',bookId:'book',code:'AP',name:'Payable',normalSide:'CREDIT',enabled:true,leaf:true},{id:'cash',bookId:'book',code:'CASH',name:'Cash',normalSide:'DEBIT',enabled:true,leaf:true}];
 const vouchers=[{id:'invoice',bookId:'book',periodId:'period',sourceKey:'BILL',date:'2026-11-10',memo:'',status:'POSTED',kind:'STANDARD',createdBy:'fixture-operator',revision:3,lines:[{subjectId:'ap',debit:'0.000000',credit:'100.000000'}]},{id:'payment',bookId:'book',periodId:'period',sourceKey:'PAYMENT',date:'2026-11-10',memo:'',status:'POSTED',kind:'STANDARD',createdBy:'fixture-operator',revision:3,lines:[{subjectId:'ap',debit:'60.000000',credit:'0.000000'}]}];
 await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());expect(url.origin).toBe('http://127.0.0.1:43439');
  if(url.pathname==='/bundle.js')return route.fulfill({contentType:'text/javascript',body:bundle});
  if(!url.pathname.startsWith('/api/'))return route.fulfill({contentType:'text/html',body:'<div id="root"></div><script src="/bundle.js"></script>'});
  expect(request.headers()['x-workspace-id']).toBe('fixture-workspace');
  if(url.pathname.endsWith('/finance-voucher-import/workbook')&&request.method()==='POST'){const body=request.postDataBuffer()!.toString('latin1');expect(body).toContain('name="bookId"');expect(body).toContain('book');expect(request.headers()['content-type']).toContain('multipart/form-data');calls.push({action:'workbook-upload'});return route.fulfill({json:{import:{}}});}
  if(url.pathname.endsWith('/finance-external-sources')&&request.method()==='POST'){const body=request.postDataJSON() as Record<string,unknown>;calls.push(body);return route.fulfill({json:body.action==='preview'?{selector:body.selector,source:{sourceFingerprint:'source-fixture-hash',currency:'USD',sourceDate:'2026-11-12',amount:'12.123456',provenance:{basis:'OBSERVED_REPORT_SPEND_ACCRUAL'}},warnings:[]}:{voucher:{id:'external-draft'},reused:false,postingExecuted:false}});}
  if(request.method()==='POST'){const body=request.postDataJSON() as Record<string,unknown>;calls.push(body);return route.fulfill({json:{reused:false,item:{},review:{id:'review'},template:{id:'template'}}});}
  if(url.pathname.endsWith('/fba-workflow-options'))return route.fulfill({json:{snapshot:{options:[{optionId:'AMZ-RETURNED-OPTION',payload:{shipmentIds:['EXTERNAL-SHIPMENT']}}]},remoteExecutionEnabled:false}});
  if(url.pathname.endsWith('/finance-structure')){calls.push({action:'structure-query',...Object.fromEntries(url.searchParams)});return route.fulfill({json:{basis:'POSTED_LEDGER',rows:[],balances:[]}});}
  if(url.pathname.endsWith('/finance-voucher-templates'))return route.fulfill({json:[]});
  if(url.pathname.endsWith('/finance-fx-revaluations'))return route.fulfill({json:{revaluations:[{id:'fx-fixture',status:'DRAFT'}]}});
  if(url.pathname.endsWith('/finance-open-items'))return route.fulfill({json:{items:[{id:'debt',bookId:'book',voucherId:'invoice',voucher:{sourceKey:'BILL'},subjectId:'ap',counterparty:'supplier:1',kind:'PAYABLE',currency:'USD',amount:'100.000000',allocated:'0.000000',remaining:'100.000000',revision:1,status:'OPEN',dueDate:'2026-11-20',evidence:'fixture'},{id:'fund',bookId:'book',voucherId:'payment',voucher:{sourceKey:'PAYMENT'},subjectId:'ap',counterparty:'supplier:1',kind:'PAYMENT',currency:'USD',amount:'60.000000',allocated:'0.000000',remaining:'60.000000',revision:1,status:'OPEN',dueDate:'2026-11-20',evidence:'fixture'}],settlements:[]}});
  if(url.pathname.endsWith('/finance-voucher-import'))return route.fulfill({json:{imports:[]}});
  if(url.pathname.endsWith('/finance-auxiliary'))return route.fulfill({json:{types:[],items:[],rules:[],voucherTypes:[],assignments:[],profile:null}});
  if(url.pathname.endsWith('/finance-close-reviews'))return route.fulfill({json:{reviews:[]}});
  if(url.pathname.endsWith('/finance-reports'))return route.fulfill({json:{templates:[],report:null}});
  return route.fulfill({json:{books:[book],periods:[period],subjects,vouchers,trial:{rows:[],openingDifference:'0.000000',movementDifference:'0.000000',closingDifference:'0.000000',balanced:true}}});
 });
 await page.goto('http://127.0.0.1:43439/operations/finance-ledger');
 await page.getByLabel('当前账套',{exact:true}).selectOption('book');await page.getByLabel('当前期间',{exact:true}).selectOption('period');
 await expect(page.getByRole('heading',{name:'应收应付与核销',exact:true})).toBeVisible();
 return {calls,errors};
}
test('partial settlement submits scoped IDs and revisions with exact decimal amount',async({page})=>{
 const {calls,errors}=await setup(page);
 await page.getByRole('combobox',{name:'应付 / 应收单据',exact:true}).selectOption('debt');await page.getByRole('combobox',{name:'付款 / 收款',exact:true}).selectOption('fund');await page.getByLabel('核销金额',{exact:true}).fill('30.000001');await page.getByLabel('核销依据',{exact:true}).fill('Synthetic bank match');await page.getByRole('button',{name:'保存核销',exact:true}).click();
 await expect.poll(()=>calls.some(row=>row.action==='settle')).toBe(true);const call=calls.find(row=>row.action==='settle')!;expect(call).toMatchObject({bookId:'book',periodId:'period',documentRevision:1,paymentRevision:1,amount:'30.000001'});expect(errors).toEqual([]);
});
test('business close UI requires evidence from all source domains and keeps selected scope',async({page})=>{
 const {calls,errors}=await setup(page);
 for(const domain of ['PROCUREMENT','COST','FBA','AMAZON','ADS','BANK','SUBLEDGER','PROFIT_LOSS'])await page.getByLabel(`${domain} 核对依据`,{exact:true}).fill(`Synthetic ${domain} scope reconciliation`);
 await page.getByRole('button',{name:'提交关账核对',exact:true}).click();await expect.poll(()=>calls.some(row=>row.action==='request-review')).toBe(true);const call=calls.find(row=>row.action==='request-review')!;expect(call.bookId).toBe('book');expect(call.periodId).toBe('period');expect(call.evidence).toHaveLength(8);expect(errors).toEqual([]);
});
test('target report template preserves explicit mapping and version',async({page})=>{
 const {calls,errors}=await setup(page);await page.getByText('财务报表与损益结转模板',{exact:true}).click();
 await page.getByLabel('财务模板 code',{exact:true}).fill('TARGET-REPORT');await page.getByLabel('财务模板 policyReference',{exact:true}).fill('Target policy v1');
 const definition={rows:[{code:'CASH',label:'Cash',metric:'CLOSING',factor:'1',subjectIds:['cash']}],closing:null};
 await page.getByLabel('目标端财务报表定义',{exact:true}).fill(JSON.stringify(definition));await page.getByRole('button',{name:'保存模板版本',exact:true}).click();await expect.poll(()=>calls.some(row=>row.action==='create-template')).toBe(true);expect(calls.find(row=>row.action==='create-template')).toMatchObject({bookId:'book',version:1,definition});expect(errors).toEqual([]);
});

test('auxiliary catalog definitions keep target policy and current book',async({page})=>{
 const {calls,errors}=await setup(page);await page.getByText('辅助核算与凭证类别',{exact:true}).click();
 await page.getByLabel('辅助定义编码',{exact:true}).fill('DEPT');await page.getByLabel('辅助定义名称',{exact:true}).fill('Target department');
 await page.getByRole('button',{name:'新增辅助类型',exact:true}).click();await expect.poll(()=>calls.some(row=>row.action==='create-type')).toBe(true);expect(calls.find(row=>row.action==='create-type')).toMatchObject({bookId:'book',code:'DEPT',name:'Target department'});expect(errors).toEqual([]);
});


test('catalog and bank commands keep selected book and exact text amounts',async({page})=>{
 const {calls,errors}=await setup(page);
 await page.getByText('币种、汇率与科目类别',{exact:true}).click();
 await page.getByLabel('目标财务目录命令',{exact:true}).fill(JSON.stringify({action:'record-rate',snapshot:{sourceCurrency:'CNY',targetCurrency:'USD',rate:'0.140000000001',observedAt:'2026-11-12T00:00:00Z',reference:'Fixture',evidence:'Target policy'}}));
 await page.getByRole('button',{name:'保存目标财务定义',exact:true}).click();
 await expect.poll(()=>calls.some(row=>row.action==='record-rate')).toBe(true);expect(calls.find(row=>row.action==='record-rate')).toMatchObject({bookId:'book',snapshot:{rate:'0.140000000001'}});
 await page.getByText('银行账户、日记账与对账',{exact:true}).click();
 await page.getByLabel('银行账户 ID',{exact:true}).fill('bank-account');
 await page.getByLabel('银行对账命令',{exact:true}).fill(JSON.stringify({action:'match-statement',statementId:'statement',voucherLineIds:['line'],evidence:'Independent match'}));
 await page.getByRole('button',{name:'提交银行核对操作',exact:true}).click();
 await expect.poll(()=>calls.some(row=>row.action==='match-statement')).toBe(true);expect(calls.find(row=>row.action==='match-statement')).toMatchObject({bookId:'book',periodId:'period',statementId:'statement'});expect(errors).toEqual([]);
});
test('XLSX upload uses multipart workspace scope and keeps draft staging separate',async({page})=>{
 const {calls,errors}=await setup(page);await page.getByText('凭证来源暂存与导入',{exact:true}).click();
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Source');sheet.addRow(['voucherKey','date','subjectCode','debit','credit','memo']);sheet.addRow(['V1','2026-11-12','EXP','1.123456','0','']);
 await page.getByLabel('凭证导入依据',{exact:true}).fill('Target workbook import evidence');
 await page.getByLabel('凭证 XLSX 模板',{exact:true}).setInputFiles({name:'voucher.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await workbook.xlsx.writeBuffer())});
 await page.getByRole('button',{name:'上传并校验 XLSX',exact:true}).click();await expect.poll(()=>calls.some(row=>row.action==='workbook-upload')).toBe(true);expect(calls.some(row=>row.action==='import-drafts')).toBe(false);expect(errors).toEqual([]);
});

test('V2 independent option selection reads scoped evidence on demand and preserves plan revision',async({page})=>{
 const {calls,errors}=await setup(page);await page.goto('http://127.0.0.1:43439/fixture-options');await page.getByText('外部装箱、分仓、运输与预约方案证据',{exact:true}).click();
 await page.getByRole('button',{name:'读取方案原证据',exact:true}).click();await expect(page.getByText('AMZ-RETURNED-OPTION',{exact:false})).toBeVisible();
 await page.getByLabel('选择外部方案 ID',{exact:true}).fill('AMZ-RETURNED-OPTION');await page.getByLabel('方案独立选择依据',{exact:true}).fill('Independent evidence review');await page.getByRole('button',{name:'保存独立选择',exact:true}).click();
 await expect.poll(()=>calls.some(row=>row.action==='SELECT_WORKFLOW_OPTION')).toBe(true);expect(calls.find(row=>row.action==='SELECT_WORKFLOW_OPTION')).toMatchObject({id:'plan',expectedRevision:4,workflowOption:{snapshotId:'snapshot',optionId:'AMZ-RETURNED-OPTION'}});expect(errors).toEqual([]);
});

test('Amazon Ads source preview submits explicit mapping and source fingerprint into draft only',async({page})=>{
 const {calls,errors}=await setup(page);await page.getByText('Amazon / Ads 来源转入',{exact:true}).click();
 const selector={kind:'ADS_SPEND',sellerAccountId:'seller',marketplaceId:'US',profileRecordId:'profile',reportType:'campaign',adProduct:'SP',date:'2026-11-12'};
 await page.getByLabel('Amazon Ads 核算来源范围',{exact:true}).fill(JSON.stringify(selector));await page.getByRole('button',{name:'预览外部核算来源',exact:true}).click();
 await page.getByLabel('外部来源正金额借方科目',{exact:true}).selectOption('cash');await page.getByLabel('外部来源正金额贷方科目',{exact:true}).selectOption('ap');await page.getByLabel('外部来源核算制度依据',{exact:true}).fill('Target accrued spend v1');await page.getByLabel('外部来源去重核对依据',{exact:true}).fill('Reviewed against bill and transaction');await page.getByRole('button',{name:'转入当前期间草稿',exact:true}).click();
 await expect.poll(()=>calls.some(row=>row.action==='import-draft')).toBe(true);expect(calls.find(row=>row.action==='import-draft')).toMatchObject({selector,sourceFingerprint:'source-fixture-hash',periodId:'period',debitSubjectId:'cash',creditSubjectId:'ap',positiveAmountSide:'EXPLICIT_DEBIT_CREDIT'});expect(calls.some(row=>row.action==='post-voucher')).toBe(false);expect(errors).toEqual([]);
});

test('FX evidence create and independent review keep target book and period without posting',async({page})=>{
 const {calls,errors}=await setup(page);await page.getByText('期末外币货币项目重估',{exact:true}).click();
 const basis={rateId:'rate',policyReference:'Target FX policy',evidence:'Foreign balances tied to posted ledger',items:[{itemKey:'asset',foreignBalance:'100.000001',carryingBase:'100.000000',balanceSide:'DEBIT',monetarySubjectId:'cash',gainSubjectId:'gain',lossSubjectId:'loss',sourceVoucherLineIds:['line'],sourceEvidence:'Subledger evidence'}]};
 await page.getByLabel('目标汇兑重估依据',{exact:true}).fill(JSON.stringify(basis));await page.getByRole('button',{name:'保存汇兑重估证据',exact:true}).click();await expect.poll(()=>calls.some(row=>row.action==='create-revaluation')).toBe(true);expect(calls.find(row=>row.action==='create-revaluation')).toMatchObject({...basis,bookId:'book',periodId:'period'});
 await page.getByLabel('汇兑重估独立审核依据',{exact:true}).fill('Independent review');await page.getByRole('button',{name:'独立审核汇兑重估',exact:true}).click();await expect.poll(()=>calls.some(row=>row.action==='review-revaluation')).toBe(true);expect(calls.find(row=>row.action==='review-revaluation')).toMatchObject({bookId:'book',revaluationId:'fx-fixture',evidence:'Independent review'});expect(calls.some(row=>row.action==='post-voucher')).toBe(false);expect(errors).toEqual([]);
});


test('FBA remote draft preserves plan revision and never queues automatically',async({page})=>{
 const {calls,errors}=await setup(page);await page.goto('http://127.0.0.1:43439/fixture-remote');await page.getByText('FBA 外部执行草稿与恢复',{exact:true}).click();
 const request={operation:'generatePlacementOptions',pathParameters:{inboundPlanId:'AMZ-PLAN'},body:{}};
 await page.getByLabel('FBA 外部执行命令',{exact:true}).fill(JSON.stringify({action:'draft',idempotencyKey:'fixture-remote',request}));await page.getByRole('button',{name:'保存外部执行动作',exact:true}).click();
 await expect.poll(()=>calls.some(row=>row.action==='draft')).toBe(true);expect(calls.find(row=>row.action==='draft')).toMatchObject({planId:'plan',expectedRevision:4,idempotencyKey:'fixture-remote',request});expect(calls.some(row=>row.action==='enqueue')).toBe(false);
 await page.getByLabel('FBA 外部执行命令',{exact:true}).fill('{invalid');await page.getByRole('button',{name:'保存外部执行动作',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();expect(calls.filter(row=>row.action==='draft')).toHaveLength(1);expect(errors).toEqual([]);
});

test('project month and target voucher template preserve explicit scope and source fields',async({page})=>{
 const {calls,errors}=await setup(page);await page.getByText('项目账户月汇总与库存凭证依据',{exact:true}).click();await page.getByLabel('项目分类辅助类型 ID',{exact:true}).fill('project-type');await page.getByRole('button',{name:'读取项目账户月汇总',exact:true}).click();await expect.poll(()=>calls.some(row=>row.action==='structure-query')).toBe(true);expect(calls.find(row=>row.action==='structure-query')).toMatchObject({bookId:'book',periodId:'period',typeId:'project-type'});
 await page.getByText('来源字段凭证映射模板',{exact:true}).click();const command={action:'preview-voucher-template',templateId:'target-template',values:{observedAmount:'1.123456'}};await page.getByLabel('来源凭证模板命令',{exact:true}).fill(JSON.stringify(command));await page.getByRole('button',{name:'提交来源模板操作',exact:true}).click();await expect.poll(()=>calls.some(row=>row.action==='preview-voucher-template')).toBe(true);expect(calls.find(row=>row.action==='preview-voucher-template')).toMatchObject({...command,bookId:'book'});expect(errors).toEqual([]);
});
