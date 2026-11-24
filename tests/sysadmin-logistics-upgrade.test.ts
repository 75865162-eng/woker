import assert from 'node:assert/strict';
import test from 'node:test';
import {
  quoteRequestTransitions, quoteTransitions, purchaseReturnTransitions,
} from '../src/lib/ext/logistics-quote-service';

test('询价状态机：草稿可提交/取消，终态不可再流转', () => {
  assert.deepEqual(quoteRequestTransitions.DRAFT, ['SUBMITTED', 'CANCELLED']);
  assert.ok(quoteRequestTransitions.SUBMITTED.includes('QUOTED'));
  assert.ok(quoteRequestTransitions.QUOTED.includes('ACCEPTED'));
  assert.deepEqual(quoteRequestTransitions.CLOSED, []);
  assert.deepEqual(quoteRequestTransitions.CANCELLED, []);
  // 不能从草稿直接跳到已接受（必须经过提交→报价）
  assert.equal(quoteRequestTransitions.DRAFT.includes('ACCEPTED'), false);
  assert.equal(quoteRequestTransitions.DRAFT.includes('CLOSED'), false);
});

test('报价状态机：提交后才能接受/拒绝，接受与拒绝均为终态', () => {
  assert.deepEqual(quoteTransitions.DRAFT, ['SUBMITTED']);
  assert.deepEqual(quoteTransitions.SUBMITTED, ['ACCEPTED', 'REJECTED']);
  assert.deepEqual(quoteTransitions.ACCEPTED, []);
  assert.deepEqual(quoteTransitions.REJECTED, []);
  assert.equal(quoteTransitions.DRAFT.includes('ACCEPTED'), false);
});

test('采购退货状态机：批准→发货→关闭不可跳过，取消可在批准前任意阶段', () => {
  assert.deepEqual(purchaseReturnTransitions.SUBMITTED, ['APPROVED', 'CANCELLED']);
  assert.deepEqual(purchaseReturnTransitions.APPROVED, ['SHIPPED', 'CANCELLED']);
  assert.deepEqual(purchaseReturnTransitions.SHIPPED, ['CLOSED']);
  assert.deepEqual(purchaseReturnTransitions.CLOSED, []);
  // 不能从已批准直接关闭（须先发货）
  assert.equal(purchaseReturnTransitions.APPROVED.includes('CLOSED'), false);
  assert.equal(purchaseReturnTransitions.DRAFT.includes('SHIPPED'), false);
});

test('三张状态机覆盖所有声明状态，无遗漏空定义', () => {
  const allStates = ['DRAFT', 'SUBMITTED', 'APPROVED', 'SHIPPED', 'CLOSED', 'CANCELLED', 'QUOTED', 'ACCEPTED', 'REJECTED'];
  for (const state of allStates) {
    const maps = [quoteRequestTransitions, quoteTransitions, purchaseReturnTransitions];
    for (const map of maps) {
      if (state in map) assert.ok(Array.isArray(map[state]), `${state} 应为数组`);
    }
  }
  assert.ok(Object.keys(quoteRequestTransitions).length >= 6);
  assert.equal(Object.keys(quoteTransitions).length, 4);
  assert.equal(Object.keys(purchaseReturnTransitions).length, 6);
});
