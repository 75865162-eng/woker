import {prisma} from '@/lib/db/prisma';
import {scoped,json} from '@/lib/wms/access';
import {WmsError,type WmsScope} from '@/lib/wms/contracts';
import {requireRevision,requireText,strictKeys} from '@/lib/wms/rules';
import {assertFinanceReviewer,assertFinanceAction} from './access';
import {parseFxRuleSnapshot,convertCostSnapshot} from './fx-rules';
export async function queryFinanceCatalog(scope:WmsScope,params:URLSearchParams){
 const bookId=requireText(params.get('bookId'),'账套 ID'),where={...scoped(scope),bookId};
 return prisma.$transaction(async tx=>{await assertFinanceAction(tx,scope,'view');const [currencies,rates,categories]=await Promise.all([tx.financeCurrency.findMany({where,orderBy:{code:'asc'},take:201}),tx.financeExchangeRate.findMany({where,orderBy:{observedAt:'desc'},take:201}),tx.financeSubjectCategory.findMany({where,orderBy:[{sortOrder:'asc'},{code:'asc'}],take:201})]);return {currencies:currencies.slice(0,200),rates:rates.slice(0,200).map(row=>({...row,rate:row.rate.toFixed(12)})),categories:categories.slice(0,200),truncated:{currencies:currencies.length>200,rates:rates.length>200,categories:categories.length>200}};},{isolationLevel:'RepeatableRead'});
}
export async function mutateFinanceCatalog(scope:WmsScope,body:Record<string,unknown>){
 const action=requireText(body.action,'财务目录动作'),bookId=requireText(body.bookId,'账套 ID');
 const fields:Record<string,string[]>={'create-currency':['code','name'],'record-rate':['snapshot'],'review-rate':['rateId'],'preview-conversion':['rateId','lines'],'create-category':['code','name','categoryType','parentId','sortOrder','isFixed'],'classify-subject':['subjectId','categoryId','revision'],'update-category':['categoryId','revision','name','sortOrder','enabled'],'delete-category':['categoryId','revision']};
 if(!fields[action])throw new WmsError('财务目录动作无效。',400);strictKeys(body,['action','bookId',...fields[action]]);
 return prisma.$transaction(async tx=>{
  await assertFinanceAction(tx,scope,action==='preview-conversion'?'create':'approve');
  await tx.$queryRaw`SELECT id FROM "FinanceBook" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId} AND id=${bookId} FOR UPDATE`;
  const book=await tx.financeBook.findFirst({where:{...scoped(scope),id:bookId,enabled:true}});if(!book)throw new WmsError('账套不存在或已停用。',404);
  const where={...scoped(scope),bookId},base={...where,id:crypto.randomUUID(),createdBy:scope.actorUserId};let result:object;
  if(action==='preview-conversion'){
   const rate=await tx.financeExchangeRate.findFirst({where:{...where,id:requireText(body.rateId,'汇率 ID'),status:'ACTIVE'}});if(!rate||!rate.reviewedBy)throw new WmsError('须选择已复核汇率快照。',409);await assertFinanceReviewer(tx,scope,rate.reviewedBy);
   if(!Array.isArray(body.lines)||!body.lines.length||body.lines.length>200)throw new WmsError('换算须有 1–200 行。',400);
   const lines=body.lines.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new WmsError('换算行无效。',400);const row=raw as Record<string,unknown>;strictKeys(row,['lineId','allocatedAmount']);return {lineId:requireText(row.lineId,'换算行 ID'),allocatedAmount:requireText(row.allocatedAmount,'原币金额')};});
   const fx=parseFxRuleSnapshot({observedAt:rate.observedAt.toISOString(),rate:rate.rate.toFixed(12),sourceCurrency:rate.sourceCurrency,targetCurrency:rate.targetCurrency,reference:rate.reference,evidence:rate.evidence});
   result={conversion:convertCostSnapshot({currency:rate.sourceCurrency,lines},fx),snapshot:{id:rate.id,sourceCurrency:rate.sourceCurrency,targetCurrency:rate.targetCurrency,rate:rate.rate.toFixed(12),observedAt:rate.observedAt,reference:rate.reference,evidence:rate.evidence},basis:'EXPLICIT_REVIEWED_RATE',createsVoucher:false};
  }else{
   await assertFinanceReviewer(tx,scope,scope.actorUserId);
   if(action==='create-currency'){
    const code=requireText(body.code,'币种编码');if(!/^[A-Z]{3}$/.test(code))throw new WmsError('币种须为三位大写编码。',400);
    result={currency:await tx.financeCurrency.create({data:{...base,code,name:requireText(body.name,'币种名称',80)}})};
   }else if(action==='record-rate'){
    const snapshot=parseFxRuleSnapshot(body.snapshot);if(await tx.financeCurrency.count({where:{...where,code:{in:[snapshot.sourceCurrency,snapshot.targetCurrency]}}})!==2)throw new WmsError('汇率两币种须先在目标账套登记。',422);
    result={rate:await tx.financeExchangeRate.create({data:{...base,...snapshot}})};
   }else if(action==='review-rate'){
    const prior=await tx.financeExchangeRate.findFirst({where:{...where,id:requireText(body.rateId,'汇率 ID')}});if(!prior)throw new WmsError('汇率快照不存在。',404);if(prior.createdBy===scope.actorUserId)throw new WmsError('汇率快照禁止自审。',403);
    result=prior.status==='ACTIVE'?{rate:prior,reused:true}:{rate:await tx.financeExchangeRate.update({where:{id:prior.id},data:{status:'ACTIVE',reviewedBy:scope.actorUserId,reviewedAt:new Date()}})};
   }else if(action==='update-category'||action==='delete-category'){
    const id=requireText(body.categoryId,'类别 ID'),revision=requireRevision(body.revision),category=await tx.financeSubjectCategory.findFirst({where:{...where,id}});if(!category||category.revision!==revision)throw new WmsError('类别不存在或版本已变化。',409);
    if(action==='delete-category'){
     if(category.isFixed||await tx.financeSubjectCategory.count({where:{...where,parentId:id}})||await tx.financeSubject.count({where:{...where,categoryId:id}}))throw new WmsError('固定或已引用类别不能删除。',409);
     await tx.financeSubjectCategory.delete({where:{id}});result={deletedId:id};
    }else{
     const name=requireText(body.name,'类别名称',120),sortOrder=body.sortOrder;if(typeof sortOrder!=='number'||!Number.isSafeInteger(sortOrder)||Math.abs(sortOrder)>10000||typeof body.enabled!=='boolean')throw new WmsError('排序或启用状态无效。',400);
     if(category.isFixed&&name!==category.name)throw new WmsError('固定类别不能改名。',409);
     if(!body.enabled&&(await tx.financeSubjectCategory.count({where:{...where,parentId:id,enabled:true}})||await tx.financeSubject.count({where:{...where,categoryId:id,enabled:true}})))throw new WmsError('类别仍有启用子类或科目，不能停用。',409);
     if(body.enabled&&category.parentId&&!await tx.financeSubjectCategory.findFirst({where:{...where,id:category.parentId,enabled:true}}))throw new WmsError('上级类别已停用。',409);
     result={category:await tx.financeSubjectCategory.update({where:{id},data:{name,sortOrder,enabled:body.enabled,revision:{increment:1}}})};
    }
   }else if(action==='create-category'){
    if(body.isFixed!==undefined&&typeof body.isFixed!=='boolean')throw new WmsError('固定类别标识无效。',400);
    const categoryType=requireText(body.categoryType,'科目大类');if(!['ASSET','LIABILITY','EQUITY','COST','PROFIT_LOSS'].includes(categoryType))throw new WmsError('科目大类无效。',400);
    const parentId=body.parentId==null||body.parentId===''?null:requireText(body.parentId,'上级类别 ID'),sortOrder=body.sortOrder;if(typeof sortOrder!=='number'||!Number.isSafeInteger(sortOrder)||Math.abs(sortOrder)>10000)throw new WmsError('排序号无效。',400);
    if(parentId){const parent=await tx.financeSubjectCategory.findFirst({where:{...where,id:parentId}});if(!parent||!parent.enabled||parent.level>=3||parent.categoryType!==categoryType)throw new WmsError('上级类别须属于同账套同大类。',422);}
    const parent=parentId?await tx.financeSubjectCategory.findFirstOrThrow({where:{...where,id:parentId}}):null;
    result={category:await tx.financeSubjectCategory.create({data:{...base,code:requireText(body.code,'类别编码',40),name:requireText(body.name,'类别名称',120),categoryType,parentId,sortOrder,level:parent?parent.level+1:1,isFixed:body.isFixed===true}})};
   }else{
    const subjectId=requireText(body.subjectId,'科目 ID'),categoryId=requireText(body.categoryId,'类别 ID'),revision=requireRevision(body.revision);
    const subject=await tx.financeSubject.findFirst({where:{...where,id:subjectId,revision,categoryId:null}});if(!subject||!await tx.financeSubjectCategory.findFirst({where:{...where,id:categoryId,enabled:true}}))throw new WmsError('科目已分类、版本已变或类别不存在。',409);
    if(await tx.financeVoucherLine.count({where:{...where,subjectId,voucher:{status:{not:'DRAFT'}}}}))throw new WmsError('已有审核凭证的科目不能改变类别。',409);
    result={subject:await tx.financeSubject.update({where:{id:subjectId},data:{categoryId,revision:{increment:1}}})};
   }
  }
  await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:`finance.catalog.${action}`,entityType:'FinanceBook',entityId:bookId,metadata:{workspaceId:scope.workspaceId,request:json(body)}}});return result;
 });
}
