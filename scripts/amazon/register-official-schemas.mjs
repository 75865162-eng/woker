// Offline, reproducible registration from explicitly supplied public model snapshots.
// Never downloads a model, reads runtime configuration, or calls seller APIs.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/amazon/register-official-schemas.mjs <public-model-directory>');
const executable = new Set(['getMarketplaceParticipations','getInventorySummaries','searchOrders','getOrder','listTransactions','searchListingsItems','getListingsItem','getCatalogItem','getSubscriptions','createReport','getReports','getReport','getReportDocument','getPricing','getCompetitiveSummary','listInboundPlans','getInboundPlan','listInboundPlanItems','getShipment','listShipmentItems']);
const snapshots = [
 ['orders','orders-api-model/orders_2026-01-01.json'],['catalog','catalog-items-api-model/catalogItems_2022-04-01.json'],
 ['listings','listings-items-api-model/listingsItems_2021-08-01.json'],['inventory','fba-inventory-api-model/fbaInventory.json'],
 ['reports','reports-api-model/reports_2021-06-30.json'],['finance','finances-api-model/finances_2024-06-19.json'],['sellers','sellers-api-model/sellers.json'],
 ['notifications','notifications-api-model/notifications.json'],
];
function enumerate(model, schema) {
 const paths = new Set(); let complete = true, dynamic = false;
 const walk = (node, pointer='', seen=new Set(), depth=0) => {
  paths.add(pointer); if (!node || typeof node !== 'object') return;
  if (depth > 32 || paths.size > 10000) { complete=false; return; }
  if (node.$ref) {
   if (!node.$ref.startsWith('#/') || seen.has(node.$ref)) { complete=false; return; }
   const target = node.$ref.slice(2).split('/').reduce((v,k)=>v?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],model);
   if (!target) { complete=false; return; }
   walk(target,pointer,new Set([...seen,node.$ref]),depth+1);
  }
  for(const [key,child] of Object.entries(node.properties??{})) walk(child,`${pointer}/${key.replace(/~/g,'~0').replace(/\//g,'~1')}`,seen,depth+1);
  if(node.items) walk(node.items,`${pointer}/*`,seen,depth+1);
  for(const child of [...(node.allOf??[]),...(node.anyOf??[]),...(node.oneOf??[])]) walk(child,pointer,seen,depth+1);
  if(node.additionalProperties) { dynamic=true; if(typeof node.additionalProperties==='object') walk(node.additionalProperties,`${pointer}/*`,seen,depth+1); }
 };
 walk(schema);return { responseFields:[...paths].sort(),fieldEnumerationComplete:complete,dynamicProperties:dynamic };
}
const output=[];
for(const [name,location] of snapshots){
 const localFile=name==='notifications'?'sp-api-notifications-official.json':`sp-api-official-${name}.json`;
 const bytes=await readFile(path.join(input,localFile));const model=JSON.parse(bytes);
 for(const [route,methods] of Object.entries(model.paths)) for(const [method,operation] of Object.entries(methods)){
  if(!operation.operationId) continue;
  const success=Object.entries(operation.responses??{}).filter(([code])=>/^2\d\d$/.test(code));
  const schema={anyOf:success.flatMap(([,response])=>response.schema?[response.schema]:[])};
  output.push({operation:operation.operationId,apiVersion:model.info.version,method:method.toUpperCase(),path:route,
   officialModel:`https://raw.githubusercontent.com/amzn/selling-partner-api-models/main/models/${location}`,
   localContract:null,contractSha256:createHash('sha256').update(bytes).digest('hex'),scope:'OFFICIAL_MODEL_SNAPSHOT',
   executable:executable.has(operation.operationId),...enumerate(model,schema)});
 }
}
// Keep the existing, tested inbound/pricing subsets; do not imply they are full models.
for(const file of ['fulfillmentInbound_2024-03-20','productPricingV0','productPricing_2022-05-01']){
 const localContract=`tests/fixtures/amazon-domain-contracts/${file}.json`,bytes=await readFile(localContract),model=JSON.parse(bytes);
 for(const [route,methods] of Object.entries(model.paths)) for(const [method,operation] of Object.entries(methods)){
  if(!operation.operationId)continue;
  output.push({operation:operation.operationId,apiVersion:model.info.version,method:method.toUpperCase(),path:route,
   officialModel:`https://github.com/amzn/selling-partner-api-models/tree/main/models`,localContract,
   contractSha256:createHash('sha256').update(bytes).digest('hex'),scope:'REVIEWED_LOCAL_CONTRACT_SUBSET',executable:executable.has(operation.operationId),
   ...enumerate(model,operation.responses?.['200']?.schema)});
 }
}
for(const [file,reportType] of [
 ['sellerSalesAndTrafficReport','GET_SALES_AND_TRAFFIC_REPORT'],['sellingPartnerSearchTermsReport','GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT'],
 ['sellingPartnerSearchQueryPerformanceReport','GET_BRAND_ANALYTICS_SEARCH_QUERY_PERFORMANCE_REPORT'],['sellingPartnerSearchCatalogPerformanceReport','GET_BRAND_ANALYTICS_SEARCH_CATALOG_PERFORMANCE_REPORT'],
 ['sellingPartnerMarketBasketAnalysisReport','GET_BRAND_ANALYTICS_MARKET_BASKET_REPORT'],['sellingPartnerRepeatPurchaseReport','GET_BRAND_ANALYTICS_REPEAT_PURCHASE_REPORT'],
]){
 const localContract=`src/data/amazon-contracts/${file}.json`,bytes=await readFile(localContract),model=JSON.parse(bytes);
 output.push({operation:reportType,apiVersion:'report-json',method:'REPORT',path:null,officialModel:`https://github.com/amzn/selling-partner-api-models/tree/main/schemas/reports`,localContract,
 contractSha256:createHash('sha256').update(bytes).digest('hex'),scope:'VENDORED_REPORT_SCHEMA',executable:true,...enumerate(model,model)});
}
output.sort((a,b)=>a.operation.localeCompare(b.operation)||a.apiVersion.localeCompare(b.apiVersion));
await writeFile('src/lib/amazon-sync/official-schema-registry.json',JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({registeredOperations:output.length,executable:output.filter(x=>x.executable).length,responsePaths:output.reduce((n,x)=>n+x.responseFields.length,0)}));
