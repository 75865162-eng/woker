import assert from 'node:assert/strict';import test from 'node:test';
import {parseFxRuleSnapshot,convertCostSnapshot} from '../src/lib/finance/fx-rules';
const fx={sourceCurrency:'USD',targetCurrency:'CNY',rate:'7.123456789012',observedAt:'2026-11-12T00:00:00Z',reference:'User supplied rate',evidence:'Synthetic source'};
test('explicit rate direction, 12 decimal precision and per-document rounding reconcile every tail',()=>{
 const parsed=parseFxRuleSnapshot(fx),source={currency:'USD',lines:[{lineId:'a',allocatedAmount:'0.000001'},{lineId:'b',allocatedAmount:'0.000001'},{lineId:'c',allocatedAmount:'0.000001'}]};
 const result=convertCostSnapshot(source,parsed);assert.equal(result.amount,'0.000021');assert.ok(result.lines.every(row=>row.allocatedAmount==='0.000007'));
 const half=convertCostSnapshot({currency:'USD',lines:[{lineId:'a',allocatedAmount:'0.000001'},{lineId:'b',allocatedAmount:'0.000002'}]},parseFxRuleSnapshot({...fx,rate:'0.5'}));assert.equal(half.amount,'0.000002');assert.deepEqual(half.lines.map(row=>row.allocatedAmount),['0.000001','0.000001']);
 assert.throws(()=>convertCostSnapshot({...source,currency:'EUR'},parsed));
 for(const change of [{rate:7},{rate:'0'},{rate:'-1'},{targetCurrency:'USD'},{observedAt:'2026-11-12'},{rate:'0.0000000000001'}])assert.throws(()=>parseFxRuleSnapshot({...fx,...change}));
});
