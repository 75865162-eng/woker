import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAuxiliaryAssignments, validateAuxiliaryAssignments } from '../src/lib/finance/auxiliary-rules';
const lines=[{lineNumber:1,subjectId:'expense'},{lineNumber:2,subjectId:'cash'}];
const rules=[{subjectId:'expense',typeId:'department',required:true}];
test('target auxiliary policy requires a valid dimension for each applicable voucher line',()=>{
 const assignments=parseAuxiliaryAssignments([{lineNumber:1,typeId:'department',itemId:'warehouse'}]);
 validateAuxiliaryAssignments(lines,rules,assignments);
 assert.throws(()=>validateAuxiliaryAssignments(lines,rules,[]));
 assert.throws(()=>validateAuxiliaryAssignments(lines,rules,[{...assignments[0],lineNumber:2}]));
 assert.throws(()=>validateAuxiliaryAssignments(lines,rules,[{...assignments[0],typeId:'employee'}]));
 validateAuxiliaryAssignments(lines,[{...rules[0],required:false}],[]);
});
test('auxiliary inputs reject duplicate dimensions, unknown fields and invalid line numbers',()=>{
 const value={lineNumber:1,typeId:'department',itemId:'warehouse'};
 assert.throws(()=>parseAuxiliaryAssignments([value,value]));
 for(const lineNumber of [0,201,1.1,'1'])assert.throws(()=>parseAuxiliaryAssignments([{...value,lineNumber}]));
 assert.throws(()=>parseAuxiliaryAssignments([{...value,amount:'1'}]));
 assert.throws(()=>parseAuxiliaryAssignments(Array(1001).fill(value)));
});
