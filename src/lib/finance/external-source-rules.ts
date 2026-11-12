import {WmsError} from '@/lib/wms/contracts';
import {requireText,strictKeys} from '@/lib/wms/rules';
import {amountUnits,unitsAmount,validFinanceDate} from './open-item-rules';
import {closeDigest} from './close-rules';
export type ExternalSelector={kind:'AMAZON_FINANCE';sellerAccountId:string;marketplaceId:string;transactionId:string}|{kind:'ADS_SPEND';sellerAccountId:string;marketplaceId:string;profileRecordId:string;reportType:string;adProduct:string;date:string};
export type ExternalSourceEvidence={kind:ExternalSelector['kind'];economicKey:string;currency:string;sourceDate:string;amount:string;provenance:Record<string,unknown>;sourceFingerprint:string};
export function parseExternalSelector(raw:unknown):ExternalSelector{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsError('外部来源范围无效。',400);const body=raw as Record<string,unknown>;
 if(body.kind!=='AMAZON_FINANCE'&&body.kind!=='ADS_SPEND')throw new WmsError('外部来源类型无效。',400);
 strictKeys(body,body.kind==='AMAZON_FINANCE'?['kind','sellerAccountId','marketplaceId','transactionId']:['kind','sellerAccountId','marketplaceId','profileRecordId','reportType','adProduct','date']);
 const common={sellerAccountId:requireText(body.sellerAccountId,'店铺 ID',200),marketplaceId:requireText(body.marketplaceId,'站点 ID',200)};
 return body.kind==='AMAZON_FINANCE'?{kind:body.kind,...common,transactionId:requireText(body.transactionId,'财务交易 ID',200)}:{kind:body.kind,...common,profileRecordId:requireText(body.profileRecordId,'内部 Profile ID',200),reportType:requireText(body.reportType,'报告类型',100),adProduct:requireText(body.adProduct,'广告产品',100),date:validFinanceDate(body.date)};
}
function signedAmount(raw:unknown){if(typeof raw!=='string')throw new WmsError('外部来源金额未提供。',422);const negative=raw.startsWith('-'),absolute=amountUnits(negative?raw.slice(1):raw);if(absolute===BigInt(0))throw new WmsError('零金额不创建来源凭证。',422);return unitsAmount(negative?-absolute:absolute);}
function currency(raw:unknown){if(typeof raw!=='string'||! /^[A-Z]{3}$/.test(raw))throw new WmsError('外部来源缺少明确币种。',422);return raw;}
function evidence(value:Omit<ExternalSourceEvidence,'sourceFingerprint'>):ExternalSourceEvidence{return {...value,sourceFingerprint:closeDigest(value)};}
export function amazonFinanceEvidence(selector:Extract<ExternalSelector,{kind:'AMAZON_FINANCE'}>,rows:readonly Record<string,unknown>[]):ExternalSourceEvidence{
 if(rows.length!==1)throw new WmsError('须查到唯一已归属的财务交易。',422);const row=rows[0];
 if(row.transactionId!==selector.transactionId||row.sellerAccountId!==selector.sellerAccountId||row.marketplaceId!==selector.marketplaceId||row.attributionStatus!=='ATTRIBUTED')throw new WmsError('财务来源交易范围或归属不符。',422);
 const postedAt=row.postedAt instanceof Date?row.postedAt.toISOString():requireText(row.postedAt,'源记账时点');if(!Number.isFinite(Date.parse(postedAt)))throw new WmsError('源记账时点无效。',422);
 const sourceDate=new Date(postedAt).toISOString().slice(0,10),amount=signedAmount(row.amount),code=currency(row.currency);
 const provenance={transactionId:selector.transactionId,sellerAccountId:selector.sellerAccountId,marketplaceId:selector.marketplaceId,sourceId:requireText(row.sourceId,'源 ID'),sourceRunId:requireText(row.sourceRunId,'源任务 ID'),rowHash:requireText(row.rowHash,'源行摘要'),observationSequence:row.observationSequence,classification:row.classification,transactionType:row.transactionType,rawStatus:row.rawStatus,marketplaceTimeZone:row.marketplaceTimeZone,postedAt,amount,currency:code,financialFinal:false,completeness:'PAGE_COMMITTED'};
 return evidence({kind:selector.kind,economicKey:'AMAZON-FINANCE:'+closeDigest([selector.sellerAccountId,selector.transactionId]),currency:code,sourceDate,amount,provenance});
}
export function adsSpendEvidence(selector:Extract<ExternalSelector,{kind:'ADS_SPEND'}>,rows:readonly Record<string,unknown>[],total:number,hasMore:boolean):ExternalSourceEvidence{
 if(!rows.length||rows.length>100||total!==rows.length||hasMore)throw new WmsError('单日广告来源须完整返回 1–100 个已观察事实；请使用更细的目标端入账合同处理大范围。',422);
 const nativeProfiles=new Set<string>(),currencies=new Set<string>(),windows=new Set<unknown>(),versions=new Set<string>(),apiVersions=new Set<string>(),keys=new Set<string>();let sum=BigInt(0);
 const records=rows.map(row=>{
  if(row.profileId!==selector.profileRecordId||row.sellerAccountId!==selector.sellerAccountId||row.marketplaceId!==selector.marketplaceId||row.reportDate!==selector.date||row.reportType!==selector.reportType||row.adProduct!==selector.adProduct||row.versionStatus!=='PUBLISHED'||row.sourceTaskStatus!=='SUCCEEDED')throw new WmsError('广告事实范围或发布状态不符。',422);
  const nativeProfile=requireText(row.amazonProfileId,'Amazon Profile ID',200);nativeProfiles.add(nativeProfile);const code=currency(row.currencyCode);currencies.add(code);windows.add(row.attributionWindow);const factKey=requireText(row.factKey,'广告事实键'),versionId=requireText(row.versionId,'已发布版本 ID'),sourceTaskId=requireText(row.sourceTaskId,'来源任务 ID');if(keys.has(factKey))throw new WmsError('广告事实键重复，不能合计。',422);keys.add(factKey);versions.add(versionId);apiVersions.add(requireText(row.apiVersion,'源 API 合同版本'));
  if(typeof row.spend!=='string')throw new WmsError('部分广告事实缺少 spend，不能补零。',422);const spend=amountUnits(row.spend);sum+=spend;
  return {factKey,versionId,sourceTaskId,spend:unitsAmount(spend),apiVersion:requireText(row.apiVersion,'源 API 合同版本')};
 }).sort((a,b)=>a.factKey.localeCompare(b.factKey));
 if(nativeProfiles.size!==1||currencies.size!==1||windows.size!==1||apiVersions.size!==1)throw new WmsError('广告来源包含不同币种、归因窗口或 API 合同，须按目标端单一口径核算。',422);if(sum===BigInt(0))throw new WmsError('零花费不创建来源凭证。',422);
 // Covers the whole profile/ad-product/day across report types, revisions and attribution windows.
 // Revisions cannot be treated as a second expense; corrections require a separate reviewed adjustment.
 return evidence({kind:selector.kind,economicKey:'ADS-SPEND:'+closeDigest([selector.sellerAccountId,selector.marketplaceId,[...nativeProfiles][0],selector.adProduct,selector.date]),currency:[...currencies][0],sourceDate:selector.date,amount:unitsAmount(sum),provenance:{...selector,amazonProfileId:[...nativeProfiles][0],attributionWindow:[...windows][0],apiVersion:[...apiVersions][0],versionIds:[...versions].sort(),records,basis:'OBSERVED_REPORT_SPEND_ACCRUAL',finalInvoice:false,completeCalendarCoverage:false}});
}
export function externalDraftLines(source:ExternalSourceEvidence,bookCurrency:string,debitSubjectId:string,creditSubjectId:string){
 if(bookCurrency!==source.currency)throw new WmsError('来源币种与账套本位币不同；必须先完成显式汇率核算。',422);if(debitSubjectId===creditSubjectId)throw new WmsError('借贷科目必须不同。',422);
 const negative=source.amount.startsWith('-'),amount=negative?source.amount.slice(1):source.amount;
 return [{subjectId:debitSubjectId,debit:negative?'0.000000':amount,credit:negative?amount:'0.000000'},{subjectId:creditSubjectId,debit:negative?amount:'0.000000',credit:negative?'0.000000':amount}];
}
