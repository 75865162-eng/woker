import assert from "node:assert/strict";
import test from "node:test";
import { availableQuantity, assertBalanceInvariant, hashWmsRequest, normalizeWmsPayload } from "../src/lib/wms/rules";
import { approvalActionFlags } from "../src/lib/wms/approval-query";

test("WMS approval controls require live permission, distinct members and unexpired approval", () => {
  const scope = { organizationId: "fixture", workspaceId: "default", actorUserId: "operator" };
  const now = new Date("2026-11-11T12:00:00.001Z");
  const access = { canEdit: true, canApprove: true, now };
  const row = { status: "APPROVED", requestedBy: "operator", approvedBy: "supervisor", expiresAt: new Date(now.getTime() + 1) };
  assert.deepEqual(approvalActionFlags(scope, row, access), { canDecide: false, canExecute: true });
  for (const expiresAt of [now, new Date(now.getTime() - 1), "invalid"]) assert.equal(approvalActionFlags(scope, { ...row, expiresAt }, access).canExecute, false);
  assert.equal(approvalActionFlags(scope, row, { ...access, canEdit: false }).canExecute, false);
  for (const approvedBy of [null, "operator"]) assert.equal(approvalActionFlags(scope, { ...row, approvedBy }, access).canExecute, false);
  for (const status of ["PENDING", "REJECTED", "CONSUMED"]) assert.equal(approvalActionFlags(scope, { ...row, status }, access).canExecute, false);
  const pending = { ...row, status: "PENDING", requestedBy: "someone-else" };
  assert.equal(approvalActionFlags(scope, pending, access).canDecide, true);
  assert.equal(approvalActionFlags(scope, pending, { ...access, canApprove: false }).canDecide, false);
  assert.equal(approvalActionFlags(scope, { ...pending, requestedBy: "operator" }, access).canDecide, false);
  assert.equal(approvalActionFlags(scope, { ...pending, expiresAt: now }, access).canDecide, false);
});

test("WMS stock buckets never become available before acceptance and putaway", () => {
  const b = { onHand: 10, pendingQc: 10, pendingPutaway: 0, rejected: 0, reserved: 0, revision: 1 };
  assert.equal(availableQuantity(b), 0);
  assert.equal(availableQuantity({ ...b, pendingQc: 0, pendingPutaway: 8, rejected: 2 }), 0);
  assert.equal(availableQuantity({ ...b, pendingQc: 0, rejected: 2 }), 8);
  assert.equal(availableQuantity({ ...b, pendingQc: 0, rejected: 2, reserved: 6 }), 2);
  assert.throws(() => assertBalanceInvariant({ ...b, reserved: 1 }));
  assert.throws(() => assertBalanceInvariant({ ...b, onHand: -1 }));
});

test("WMS normalized request hash binds revision, aggregate and every quantity", () => {
  const input = { action: "INSPECT" as const, aggregateId: "r1", expectedRevision: 2, payload: normalizeWmsPayload({ action: "INSPECT", lines: [{ lineId: "a", acceptedQty: 8, rejectedQty: 2 }] }) };
  assert.equal(hashWmsRequest(input), hashWmsRequest({ ...input }));
  assert.notEqual(hashWmsRequest(input), hashWmsRequest({ ...input, expectedRevision: 3 }));
  assert.notEqual(hashWmsRequest(input), hashWmsRequest({ ...input, aggregateId: "r2" }));
});

test("WMS rejects duplicate lines, fractions, overflow and unknown payload fields", () => {
  for (const quantity of [0, -1, 1.5, 2_147_483_648, "1"]) assert.throws(() => normalizeWmsPayload({ action: "RECEIVE", lines: [{ lineId: "a", quantity }] }));
  assert.throws(() => normalizeWmsPayload({ action: "RECEIVE", lines: [{ lineId: "a", quantity: 1 }, { lineId: "a", quantity: 1 }] }));
  assert.throws(() => normalizeWmsPayload({ action: "RECEIVE", actorUserId: "spoof", lines: [{ lineId: "a", quantity: 1 }] }));
  assert.throws(() => normalizeWmsPayload({ action: "RECEIVE", lines: [{ lineId: "a", quantity: 1, approved: true }] }));
  assert.deepEqual(normalizeWmsPayload({ action: "RETURN_REJECTED", lines: [{ lineId: "a", quantity: 1 }] }), { action: "RETURN_REJECTED", lines: [{ lineId: "a", quantity: 1 }] });
});

test("WMS row actions distinguish free, picked and already dispatched quantities", async () => {
  const { stockActionLimit } = await import("../src/lib/wms/stock-action-view");
  const reservation = { requestedQty: 10, releasedQty: 2, dispatchedQty: 3, pickedQty: 4 };
  assert.equal(stockActionLimit(reservation, "PICK"), 1);
  assert.equal(stockActionLimit(reservation, "RELEASE"), 1);
  assert.equal(stockActionLimit(reservation, "DISPATCH"), 4);
  assert.equal(stockActionLimit(reservation, "UNPICK"), 4);
  assert.equal(stockActionLimit({ onHand: 10, pendingQc: 2, pendingPutaway: 3, rejected: 1, reserved: 2 }, "RESERVE"), 2);
  assert.equal(stockActionLimit({ onHand: 10 }, "RESERVE"), null);
  assert.equal(stockActionLimit({ ...reservation, pickedQty: 99 }, "RELEASE"), null);
});

test("WMS multi-line partial putaway skips zero lines without requiring their locations", async () => {
  const { receiptActionPayload } = await import("../src/lib/wms/receipt-action-view");
  const lines = [{ id: "a", acceptedQty: 5, putawayQty: 2 }, { id: "b", acceptedQty: 3, putawayQty: 3 }];
  const values = { a: { quantity: "2", acceptedQty: "0", rejectedQty: "0", locationId: "storage" }, b: { quantity: "0", acceptedQty: "0", rejectedQty: "0", locationId: "" } };
  assert.deepEqual(receiptActionPayload(lines, "PUTAWAY", values), { action: "PUTAWAY", lines: [{ lineId: "a", locationId: "storage", quantity: 2 }] });
  assert.throws(() => receiptActionPayload(lines, "PUTAWAY", { ...values, a: { ...values.a, quantity: "4" } }), /剩余数量/);
  assert.throws(() => receiptActionPayload(lines, "PUTAWAY", { ...values, a: { ...values.a, locationId: "" } }), /目标库位/);
  for (const quantity of ["-1", "1.5", "", "NaN"]) assert.throws(() => receiptActionPayload(lines, "PUTAWAY", { ...values, b: { ...values.b, quantity } }));
});

test("WMS rejected returns use only the unreturned rejected balance", async () => {
  const { receiptActionPayload, receiptActionRemaining } = await import("../src/lib/wms/receipt-action-view");
  const lines = [{ id: "a", rejectedQty: 4, returnedQty: 1 }, { id: "b", rejectedQty: 2, returnedQty: 2 }];
  const values = { a: { quantity: "3", acceptedQty: "0", rejectedQty: "0", locationId: "" }, b: { quantity: "0", acceptedQty: "0", rejectedQty: "0", locationId: "" } };
  assert.equal(receiptActionRemaining(lines[0], "RETURN_REJECTED"), 3);
  assert.deepEqual(receiptActionPayload(lines, "RETURN_REJECTED", values), { action: "RETURN_REJECTED", lines: [{ lineId: "a", quantity: 3 }] });
  assert.throws(() => receiptActionPayload(lines, "RETURN_REJECTED", { ...values, a: { ...values.a, quantity: "4" } }), /剩余数量/);
});

test("WMS inspection validates combined acceptance/rejection; receive records omitted lines as short", async () => {
  const { receiptActionPayload } = await import("../src/lib/wms/receipt-action-view");
  const line = { id: "a", expectedQty: 10, receivedQty: 10, acceptedQty: 5, rejectedQty: 2 };
  const values = { a: { quantity: "0", acceptedQty: "2", rejectedQty: "1", locationId: "" } };
  assert.deepEqual(receiptActionPayload([line], "INSPECT", values), { action: "INSPECT", lines: [{ lineId: "a", acceptedQty: 2, rejectedQty: 1 }] });
  assert.throws(() => receiptActionPayload([line], "INSPECT", { a: { ...values.a, rejectedQty: "2" } }), /剩余数量/);
  const receiveLines = [{ id: "a", expectedQty: 10, receivedQty: 0 }, { id: "b", expectedQty: 3, receivedQty: 0 }];
  const receiveValues = { a: { ...values.a, quantity: "4" }, b: { ...values.a, quantity: "0" } };
  assert.deepEqual(receiptActionPayload(receiveLines, "RECEIVE", receiveValues), { action: "RECEIVE", lines: [{ lineId: "a", quantity: 4 }] });
  assert.throws(() => receiptActionPayload(receiveLines, "RECEIVE", { a: { ...values.a, quantity: "0" }, b: { ...values.a, quantity: "0" } }), /至少填写一行/);
});

test("Stocktake distinguishes an explicit zero from missing observations and rejects malformed scope lines", () => {
  const line = { locationId: "L", lotId: "LOT", countedQty: 0 };
  assert.deepEqual(normalizeWmsPayload({ action: "STOCKTAKE_COUNT", lines: [line] }), { action: "STOCKTAKE_COUNT", lines: [line] });
  for (const countedQty of [undefined, null, "", "0", -1, 0.5, Infinity, 2_147_483_648]) {
    assert.throws(() => normalizeWmsPayload({ action: "STOCKTAKE_COUNT", lines: [{ ...line, countedQty }] }));
  }
  for (const lines of [[], [line, line], [{ ...line, baselineOnHand: 9 }], [{ ...line, locationId: "" }], Array.from({ length: 101 }, (_, i) => ({ ...line, lotId: String(i) }))]) {
    assert.throws(() => normalizeWmsPayload({ action: "STOCKTAKE_COUNT", lines }));
  }
  for (const action of ["STOCKTAKE_START", "STOCKTAKE_REVIEW", "STOCKTAKE_CANCEL", "STOCKTAKE_POST"]) {
    assert.deepEqual(normalizeWmsPayload({ action }), { action });
    assert.throws(() => normalizeWmsPayload({ action, lines: [line] }));
    assert.throws(() => normalizeWmsPayload({ action, approved: true }));
  }
});
