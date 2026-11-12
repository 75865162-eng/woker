import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateBinding} from '../src/lib/fba-local/remote-action-service';
import {encryptCheckpoint} from '../src/lib/amazon-sync/checkpoint';
import type {Tx} from '../src/lib/wms/repository';
process.env.AMAZON_SP_API_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');
const scope={organizationId:'fixture-org',workspaceId:'fixture-workspace',actorUserId:'fixture-user'};
function fixture(options:{shipments?:string[];selected?:string|null;knownOption?:string;operationId?:string|null;snapshots?:unknown[];results?:unknown[]}={}){
 const check=(args:{where:Record<string,unknown>})=>{assert.equal(args.where.organizationId,scope.organizationId);assert.equal(args.where.workspaceId,scope.workspaceId);assert.equal(args.where.planId,'LOCAL-PLAN');};
 return {
  fbaLocalPlan:{findFirstOrThrow:async()=>({marketplaceId:'SITE'})},fbaLocalPlanLine:{findMany:async(args:{where:Record<string,unknown>})=>{check(args);return [{id:'LINE',quantity:2}];}},
  fbaRemotePlanBinding:{findFirst:async(args:{where:Record<string,unknown>})=>{check(args);return {externalPlanId:'AMZ-PLAN'};}},
  fbaLocalShipment:{findMany:async(args:{where:Record<string,unknown>})=>{check(args);return (options.shipments??[]).map(spApiShipmentId=>({spApiShipmentId}));}},
  fbaWorkflowOptionSnapshot:{findMany:async(args:{where:Record<string,unknown>})=>{check(args);assert.equal(args.where.externalPlanId,'AMZ-PLAN');return options.snapshots??(options.knownOption?[{kind:'PLACEMENT',options:[{optionId:options.knownOption,payload:{placementOptionId:options.knownOption}}],selection:options.selected?{optionId:options.selected}:null}]:[]);}},
  fbaRemoteAction:{findMany:async(args:{where:Record<string,unknown>})=>{check(args);return options.results??[];},findFirst:async(args:{where:Record<string,unknown>})=>{check(args);return args.where.operationId===options.operationId?{id:'KNOWN-OPERATION-RECORD'}:null;}},
 } as unknown as Tx;
}
test('plan runner rejects unscoped account operations and foreign label marketplace',async()=>{
 for(const operation of ['listInboundPlans','listItemComplianceDetails','listPrepDetails','setPrepDetails','updateItemComplianceDetails','createMarketplaceItemLabels'])await assert.rejects(()=>validateBinding(fixture(),scope,'LOCAL-PLAN',{body:{marketplaceId:'FOREIGN-SITE',mskuQuantities:[{msku:'FOREIGN-SKU',quantity:1}]}},operation));
});
test('plan runner requires exact bound external plan and known operation provenance',async()=>{
 await validateBinding(fixture(),scope,'LOCAL-PLAN',{pathParameters:{inboundPlanId:'AMZ-PLAN'}},'getInboundPlan');
 await assert.rejects(()=>validateBinding(fixture(),scope,'LOCAL-PLAN',{pathParameters:{inboundPlanId:'FOREIGN-PLAN'}},'getInboundPlan'));
 await assert.rejects(()=>validateBinding(fixture(),scope,'LOCAL-PLAN',{pathParameters:{operationId:'FOREIGN-OPERATION'}},'getInboundOperationStatus'));
 await validateBinding(fixture({operationId:'KNOWN-OPERATION'}),scope,'LOCAL-PLAN',{pathParameters:{operationId:'KNOWN-OPERATION'}},'getInboundOperationStatus');
});
test('child shipment IDs must come from evidence belonging to this scoped plan',async()=>{
 const tx=fixture({shipments:['OWN-SHIPMENT']});
 await validateBinding(tx,scope,'LOCAL-PLAN',{pathParameters:{inboundPlanId:'AMZ-PLAN',shipmentId:'OWN-SHIPMENT'}},'getShipment');
 await assert.rejects(()=>validateBinding(tx,scope,'LOCAL-PLAN',{pathParameters:{inboundPlanId:'AMZ-PLAN',shipmentId:'FOREIGN-SHIPMENT'}},'getShipment'));
});
test('external option confirmation requires independent selection as well as known ID',async()=>{
 const request={pathParameters:{inboundPlanId:'AMZ-PLAN',placementOptionId:'OPTION'}};
 await assert.rejects(()=>validateBinding(fixture({knownOption:'OPTION'}),scope,'LOCAL-PLAN',request,'confirmPlacementOption'));
 await validateBinding(fixture({knownOption:'OPTION',selected:'OPTION'}),scope,'LOCAL-PLAN',request,'confirmPlacementOption');
 await assert.rejects(()=>validateBinding(fixture({knownOption:'OPTION',selected:'OTHER'}),scope,'LOCAL-PLAN',request,'confirmPlacementOption'));
});

function result(operation:string,pathParameters:Record<string,string>,response:unknown={}){const id=operation;return {id,operation,requestCiphertext:encryptCheckpoint(JSON.stringify({operation,pathParameters}),scope,`fba-remote-request:${id}`),responseCiphertext:encryptCheckpoint(JSON.stringify(response),scope,`fba-remote-response:${id}`)};}
function snapshot(kind:string,id:string,payload:unknown){return {kind,options:[{optionId:id,payload}],selection:{optionId:id}};}
test('body transportation option must belong to the exact shipment, even within same plan',async()=>{
 const tx=fixture({shipments:['SHIP-A','SHIP-B'],snapshots:[snapshot('TRANSPORTATION','OPT-A',{transportationOptionId:'OPT-A',shipmentId:'SHIP-A'})]});
 const request=(shipmentId:string)=>({pathParameters:{inboundPlanId:'AMZ-PLAN'},body:{transportationSelections:[{shipmentId,transportationOptionId:'OPT-A'}]}});
 await validateBinding(tx,scope,'LOCAL-PLAN',request('SHIP-A'),'confirmTransportationOptions');
 await assert.rejects(()=>validateBinding(tx,scope,'LOCAL-PLAN',request('SHIP-B'),'confirmTransportationOptions'),/来源关联/);
 await assert.rejects(()=>validateBinding(tx,scope,'LOCAL-PLAN',request('FOREIGN'),'confirmTransportationOptions'));
});
test('delivery window provenance retains original listing shipment scope',async()=>{
 const tx=fixture({shipments:['SHIP-A','SHIP-B'],snapshots:[snapshot('DELIVERY_WINDOW','WINDOW',{deliveryWindowOptionId:'WINDOW'})],results:[result('listDeliveryWindowOptions',{inboundPlanId:'AMZ-PLAN',shipmentId:'SHIP-A'},{deliveryWindowOptions:[{deliveryWindowOptionId:'WINDOW'}]})]});
 const request=(shipmentId:string)=>({pathParameters:{inboundPlanId:'AMZ-PLAN',shipmentId,deliveryWindowOptionId:'WINDOW'}});
 await validateBinding(tx,scope,'LOCAL-PLAN',request('SHIP-A'),'confirmDeliveryWindowOptions');await assert.rejects(()=>validateBinding(tx,scope,'LOCAL-PLAN',request('SHIP-B'),'confirmDeliveryWindowOptions'),/来源关联/);
});
test('packing IDs follow successful Amazon confirmations rather than local selection alone',async()=>{
 const snapshots=[snapshot('PACKING','PACK',{packingOptionId:'PACK',packingGroups:['GROUP']}),snapshot('PLACEMENT','PLACE',{placementOptionId:'PLACE',shipmentIds:['SHIP-A']})];
 const request=(group:unknown)=>({pathParameters:{inboundPlanId:'AMZ-PLAN'},body:{packageGroupings:[group]}});
 await assert.rejects(()=>validateBinding(fixture({snapshots}),scope,'LOCAL-PLAN',request({packingGroupId:'GROUP'}),'setPackingInformation'),/工作流阶段/);
 const results=[result('confirmPackingOption',{inboundPlanId:'AMZ-PLAN',packingOptionId:'PACK'})];
 await validateBinding(fixture({snapshots,results}),scope,'LOCAL-PLAN',request({packingGroupId:'GROUP'}),'setPackingInformation');
 await assert.rejects(()=>validateBinding(fixture({snapshots,results,shipments:['SHIP-A']}),scope,'LOCAL-PLAN',request({shipmentId:'SHIP-A'}),'setPackingInformation'),/工作流阶段/);
 results.unshift(result('confirmPlacementOption',{inboundPlanId:'AMZ-PLAN',placementOptionId:'PLACE'}));
 const placed=fixture({snapshots,results,shipments:['SHIP-A','SHIP-B']});
 await validateBinding(placed,scope,'LOCAL-PLAN',request({shipmentId:'SHIP-A'}),'setPackingInformation');
 await assert.rejects(()=>validateBinding(placed,scope,'LOCAL-PLAN',request({packingGroupId:'GROUP'}),'setPackingInformation'),/工作流阶段/);
 await assert.rejects(()=>validateBinding(placed,scope,'LOCAL-PLAN',request({shipmentId:'SHIP-B'}),'setPackingInformation'),/工作流阶段/);
});

test('marketplace item labels require exact scoped plan mapping and quantities',async()=>{
 const mapping=[{planLineId:'LINE',sellerSku:'SKU',evidence:'Synthetic verified mapping'}],request={body:{marketplaceId:'SITE',mskuQuantities:[{msku:'SKU',quantity:2}]}};
 await validateBinding(fixture(),scope,'LOCAL-PLAN',request,'createMarketplaceItemLabels',mapping);
 await assert.rejects(()=>validateBinding(fixture(),scope,'LOCAL-PLAN',request,'createMarketplaceItemLabels'));
 await assert.rejects(()=>validateBinding(fixture(),scope,'LOCAL-PLAN',{body:{...request.body,mskuQuantities:[{msku:'OTHER',quantity:2}]}},'createMarketplaceItemLabels',mapping));
 await assert.rejects(()=>validateBinding(fixture(),scope,'LOCAL-PLAN',{body:{...request.body,mskuQuantities:[{msku:'SKU',quantity:3}]}},'createMarketplaceItemLabels',mapping));
 await assert.rejects(()=>validateBinding(fixture(),scope,'LOCAL-PLAN',request,'createMarketplaceItemLabels',[...mapping,...mapping]));
});
