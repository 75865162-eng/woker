process.env.AMAZON_API_EXECUTION_ROLE='cloud';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseInboundOperation,inboundOperationNames,inboundOperationCatalog,inboundOperationForRequest,inboundContractProvenance,inboundAsyncOperations,inboundVoidOperations,inboundOperationIsReadOnly} from '../src/lib/fba-local/inbound-write-contract';
import {AmazonSpApiClient} from '../src/lib/amazon/sp-api-client';
import {getAmazonSpApiServerConfiguration} from '../src/lib/amazon/sp-api-config';
const config=getAmazonSpApiServerConfiguration({AMAZON_SP_API_LWA_CLIENT_ID:'fixture-id',AMAZON_SP_API_LWA_CLIENT_SECRET:'fixture-secret',AMAZON_SP_API_REFRESH_TOKEN:'fixture-refresh'});
const create={operation:'createInboundPlan' as const,body:{destinationMarketplaces:['SITE'],items:[{msku:'SKU',quantity:2,labelOwner:'SELLER',prepOwner:'SELLER'}],sourceAddress:{addressLine1:'Synthetic address',city:'Fixture',countryCode:'US',name:'Fixture contact',phoneNumber:'0000000000',postalCode:'00000',stateOrProvinceCode:'CA'}}};
test('source Inbound contract retains all operation paths and differentiates list from generation',()=>{
 assert.deepEqual(inboundVoidOperations,['updateInboundPlanName','updateShipmentName']);
 assert.equal(inboundAsyncOperations.length,19);assert.ok(inboundAsyncOperations.includes('createInboundPlan'));assert.ok(!inboundAsyncOperations.includes('getInboundOperationStatus'));assert.ok(!inboundAsyncOperations.includes('createMarketplaceItemLabels'));
 assert.equal(inboundOperationNames.length,45);assert.equal(inboundContractProvenance.currentOfficialParityVerified,false);
 for(const [name,definition]of Object.entries(inboundOperationCatalog))assert.equal(inboundOperationForRequest('https://fixture.invalid'+definition.path.replace(/\{\w+\}/g,'FIXTURE'),definition.method),name);
 const request=parseInboundOperation(create);assert.equal(request.method,'POST');assert.equal(request.path,'/inbound/fba/2024-03-20/inboundPlans');assert.equal(request.mutating,true);
 assert.throws(()=>parseInboundOperation({...create,path:'https://evil.invalid'}));assert.throws(()=>parseInboundOperation({operation:'createAnything',body:{}}));
 assert.throws(()=>parseInboundOperation({...create,body:{...create.body,items:[{...create.body.items[0],quantity:0}]}}));
 assert.throws(()=>parseInboundOperation({...create,body:{...create.body,sourceAddress:{...create.body.sourceAddress,unrecognized:'value'}}}));
 assert.throws(()=>parseInboundOperation({operation:'cancelInboundPlan',pathParameters:{inboundPlanId:'../escape'}}));
});
test('strict nested request DTOs keep decimal lexemes and reject lossy numbers',()=>{
 const body={packageGroupings:[{packingGroupId:'GROUP',boxes:[{contentInformationSource:'BOX_CONTENT_PROVIDED',dimensions:{height:'1.2',length:'2',width:'3',unitOfMeasurement:'CM'},weight:{unit:'KG',value:'4.000001'},quantity:1,items:[{msku:'SKU',quantity:2,labelOwner:'SELLER',prepOwner:'SELLER'}]}]}]};
 const parsed=parseInboundOperation({operation:'setPackingInformation',pathParameters:{inboundPlanId:'PLAN'},body});assert.equal((parsed.body as {packageGroupings:{boxes:{weight:{value:number}}[]}[]}).packageGroupings[0].boxes[0].weight.value,4.000001);
 assert.throws(()=>parseInboundOperation({operation:'setPackingInformation',pathParameters:{inboundPlanId:'PLAN'},body:{packageGroupings:[{...body.packageGroupings[0],boxes:[{...body.packageGroupings[0].boxes[0],weight:{unit:'KG',value:'9007199254740993'}}]}]}}));
});
test('injected transport submits PUT cancellation, exact operation events, LWA and per-request authorization',async()=>{
 const requests:{url:string;method:string;body:string|undefined}[]=[],events:string[]=[];let checks=0;
 const client=new AmazonSpApiClient(config,{beforeRequest:async()=>{checks++;},onResponse:event=>events.push(event.operation),fetch:async(url,init)=>{
  requests.push({url:String(url),method:init?.method??'GET',body:init?.body===undefined?undefined:String(init.body)});
  return String(url).includes('auth/o2/token')?Response.json({access_token:'fixture-token',expires_in:3600}):Response.json({operationId:'OPERATION',operationStatus:'IN_PROGRESS'});
 }});
 await client.executeInboundOperation({operation:'cancelInboundPlan',pathParameters:{inboundPlanId:'PLAN'}});
 await client.executeInboundOperation({operation:'generatePackingOptions',pathParameters:{inboundPlanId:'PLAN'}});
 await client.executeInboundOperation({operation:'listPackingOptions',pathParameters:{inboundPlanId:'PLAN'},query:{pageSize:10,paginationToken:'TOKEN'}});
 await client.getInboundOperationStatus({operationId:'OPERATION'});
 assert.equal(requests[1].method,'PUT');assert.equal(requests[1].body,undefined);assert.equal(checks,5);assert.deepEqual(events,['LWA','cancelInboundPlan','generatePackingOptions','listPackingOptions','getInboundOperationStatus']);
 let unsafeRequests=0;const unbound=new AmazonSpApiClient(config,{fetch:async()=>{unsafeRequests++;throw Error('must not send');}});await assert.rejects(()=>unbound.executeInboundOperation(create));assert.equal(unsafeRequests,0);
});

test('synchronous source-SDK Void responses keep empty HTTP success without operation ID',async()=>{
 const client=new AmazonSpApiClient(config,{beforeRequest:async()=>{},fetch:async(url)=>String(url).includes('auth/o2/token')?Response.json({access_token:'fixture-token',expires_in:3600}):new Response(null,{status:204})});
 const response=await client.executeInboundOperation({operation:'updateInboundPlanName',pathParameters:{inboundPlanId:'PLAN'},body:{name:'Fixture name'}});assert.equal(response.body,null);assert.equal(response.rawBody,'');
});

test('only manifest proven GET operations are classified read only',()=>{assert.equal(inboundOperationIsReadOnly('getInboundPlan'),true);assert.equal(inboundOperationIsReadOnly('listShipmentBoxes'),true);assert.equal(inboundOperationIsReadOnly('createMarketplaceItemLabels'),false);assert.equal(inboundOperationIsReadOnly('unknownGet'),false);assert.equal(inboundOperationIsReadOnly('constructor'),false);});
