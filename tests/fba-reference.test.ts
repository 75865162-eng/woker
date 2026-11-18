import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteReferenceFba, referenceModel, referenceViews } from '../src/lib/ext/fba-reference';
import { quoteOnly } from '../src/lib/ext/pricing';
const base = {rateModel:referenceModel,category:'服装和配饰',date:'2026-11-18',price:'15',weightLb:'0.5',lengthIn:'8',widthIn:'6',heightIn:'0.5'};
const fee=(input:Record<string,unknown>,id:string)=>quoteReferenceFba({...base,...input}).fees.find(f=>f.id===id)!;
test('服装价格分档、旺季与燃油按独立有效日期计算',()=>{
  assert.equal(fee({},'shipping').amount,'3.9400');
  assert.equal(fee({},'referral').amount,'0.7500');
  assert.equal(fee({price:'20'},'referral').amount,'2.0000');
  assert.equal(fee({price:'21'},'referral').amount,'3.5700');
  assert.equal(fee({},'fuel').amount,'0.1379');
  assert.equal(fee({date:'2026-10-14'},'shipping').amount,'3.6900');
  assert.equal(fee({date:'2026-04-16'},'fuel').amount,'0.0000');
  assert.equal(fee({date:'2027-01-15'},'shipping').amount,null);
});
test('小号标准不因体积重升级，150磅以上使用实际重量',()=>{
  const small=quoteReferenceFba({...base,lengthIn:'15',widthIn:'12',heightIn:'0.75',weightLb:'1'});
  assert.equal(small.sizeTier,'小号标准尺寸');assert.equal(small.weightLb,1);
  assert.equal(quoteReferenceFba({...base,lengthIn:'100',widthIn:'50',heightIn:'50',weightLb:'160'}).weightLb,160);
});
test('仓储淡旺季独立于配送日期，缺失因素不造零',()=>{
  const volume=8*6*0.5/1728;
  assert.equal(fee({date:'2026-10-01'},'storageBase').amount,(volume*2.4).toFixed(4));
  assert.equal(fee({},'utilization').amount,null);
  assert.equal(fee({utilizationWeeks:'22'},'utilization').amount,(volume*0.44).toFixed(4));
  assert.equal(fee({utilizationExempt:'true'},'utilization').amount,'0.0000');
  assert.equal(fee({ageDays:'181'},'aged').amount,'0.0000');
  assert.equal(fee({ageDays:'300'},'aged').amount,null);
  assert.equal(fee({ageDays:'366'},'aged').amount,'0.3000');
  assert.equal(fee({supply30:'28'},'low').amount,'0.0000');
  assert.equal(fee({supply30:'14',supply90:'21'},'low').amount,'0.3200');
});
test('移除弃置同价，按重量边界计费，清货扣处理费与佣金',()=>{
  assert.equal(fee({},'disposal').amount,'0.8400');
  assert.equal(fee({weightLb:'0.5001'},'disposal').amount,'1.5300');
  assert.equal(fee({weightLb:'1.2'},'disposal').amount,'2.2700');
  assert.equal(fee({weightLb:'1.2'},'removal').amount,'2.2700');
  assert.equal(fee({weightLb:'1.2',recoveryValue:'40'},'recovery').amount,'33.6500');
});
test('已移除的特殊场景参数不再参与计算，异常参数拒绝',()=>{
  const removed={hazardous:'true',battery:'true',sipp:'true',specialHandling:'true',prescription:'true',shippingCharge:'100',giftWrap:'100'};
  assert.deepEqual(quoteReferenceFba({...base,...removed}),quoteReferenceFba(base));
  assert.deepEqual(quoteReferenceFba({...base,category:'宠物用品',...removed}),quoteReferenceFba({...base,category:'宠物用品'}));
  assert.ok(!quoteReferenceFba({...base,...removed}).fees.some(f=>['battery','sipp'].includes(f.id)));
  assert.throws(()=>quoteReferenceFba({...base,weightLb:'-1'}));
  assert.throws(()=>quoteReferenceFba({...base,date:'2026-02-30'}));
  assert.throws(()=>quoteReferenceFba({...base,shippedUnits:'10',returnedUnits:'11'}));
});
test('保存入口与即时测算复用相同规则，完整手册保留全部分类',()=>{
  assert.deepEqual(quoteOnly('fee',base),quoteReferenceFba(base));
  assert.deepEqual(referenceViews.map(v=>v.id),['overview','calc','inbound','storage','shipping','sales','reverse','changes','dictionary']);
  assert.equal(referenceViews.find(v=>v.id==='dictionary')!.blocks[0].rows!.length,29);
});

test('淡旺季同时报价：配送、仓储和人工处理分别切换，不影响弃置及佣金',()=>{
  const input={...base,manual:'true',utilizationWeeks:'22'};
  const offPeak=quoteReferenceFba(input,'offPeak');
  const peak=quoteReferenceFba(input,'peak');
  const amount=(quote:ReturnType<typeof quoteReferenceFba>,id:string)=>quote.fees.find(f=>f.id===id)!.amount;
  assert.equal(amount(offPeak,'shipping'),'3.6900');
  assert.equal(amount(peak,'shipping'),'3.9400');
  assert.equal(amount(offPeak,'fuel'),'0.1292');
  assert.equal(amount(peak,'fuel'),'0.1379');
  assert.equal(amount(offPeak,'storageBase'),(8*6*0.5/1728*0.78).toFixed(4));
  assert.equal(amount(peak,'storageBase'),(8*6*0.5/1728*2.4).toFixed(4));
  assert.equal(amount(offPeak,'manual'),'0.1500');
  assert.equal(amount(peak,'manual'),'0.3000');
  for (const id of ['disposal','removal','referral','utilization']) assert.equal(amount(offPeak,id),amount(peak,id));
  for (const season of ['offPeak','peak'] as const) {
    assert.equal(amount(quoteReferenceFba({...input,date:'2027-02-01'},season),'shipping'),null);
  }
});
