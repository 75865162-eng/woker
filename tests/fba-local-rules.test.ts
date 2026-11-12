import assert from "node:assert/strict";
import test from "node:test";
import { assertPlanCancellable, draftHash, parseFbaPlanDraft, reservationCommand, reservationProgress } from "../src/lib/fba-local/rules";

const draft = { number: "FBA-LOCAL-1", sellerAccountId: "seller", marketplaceId: "site", idempotencyKey: "fixture", lines: [{ balanceId: "b", quantity: 2 }, { balanceId: "a", quantity: 1 }] };

test("local FBA draft binds all quantities and account/site while canonicalizing line order", () => {
  assert.equal(draftHash(draft), draftHash({ ...draft, lines: [...draft.lines].reverse() }));
  for (const change of [{ marketplaceId: "other" }, { sellerAccountId: "other" }, { lines: [{ balanceId: "a", quantity: 2 }] }]) assert.notEqual(draftHash(draft), draftHash({ ...draft, ...change }));
  assert.equal(parseFbaPlanDraft(draft).lines[0].balanceId, "a");
});

test("local FBA rejects spoofed identity, external IDs, duplicate balances and malformed quantities", () => {
  for (const raw of [null, [], { ...draft, organizationId: "other" }, { ...draft, spApiInboundPlanId: "fake" }, { ...draft, lines: [] }, { ...draft, lines: Array(101).fill(draft.lines[0]) }, { ...draft, lines: [draft.lines[0], draft.lines[0]] }]) assert.throws(() => parseFbaPlanDraft(raw));
  for (const quantity of [0, -1, 0.5, "2", Number.MAX_SAFE_INTEGER, NaN]) assert.throws(() => parseFbaPlanDraft({ ...draft, lines: [{ balanceId: "a", quantity }] }));
});

test("local FBA inventory approvals bind immutable line and stock revision", () => {
  const line = { id: "line", balanceId: "balance", quantity: 4 };
  const command = reservationCommand("default", line, 2);
  assert.equal(command.aggregateId, "balance");
  assert.deepEqual(command.payload, { action: "RESERVE", number: "FBA-LOCAL:line", quantity: 4 });
  assert.notEqual(command.idempotencyKey, reservationCommand("default", line, 3).idempotencyKey);
  assert.notEqual(command.idempotencyKey, reservationCommand("default", { ...line, id: "other" }, 2).idempotencyKey);
});

test("local FBA readiness follows live reserved/released/dispatched quantities", () => {
  const row = { requestedQty: 5, releasedQty: 0, dispatchedQty: 0, pickedQty: 0 };
  assert.equal(reservationProgress(5, null).status, "NEEDS_RESERVATION");
  assert.equal(reservationProgress(5, row).reservedQty, 5);
  assert.equal(reservationProgress(5, { ...row, releasedQty: 2 }).status, "PARTIALLY_RELEASED");
  assert.equal(reservationProgress(5, { ...row, dispatchedQty: 5 }).status, "DISPATCHED");
  assert.equal(reservationProgress(5, { ...row, dispatchedQty: 1 }).status, "PARTIALLY_DISPATCHED");
  assert.throws(() => reservationProgress(6, row));
  assert.throws(() => reservationProgress(5, { ...row, pickedQty: 3, releasedQty: 3 }));
  assert.throws(() => assertPlanCancellable([row]));
  assert.throws(() => assertPlanCancellable([{ ...row, dispatchedQty: 5 }]));
  assert.doesNotThrow(() => assertPlanCancellable([null, { ...row, releasedQty: 5 }]));
});

test("local plan totals follow partial picking, dispatch and released shortfalls across lines", async () => {
  const { planFulfillment } = await import("../src/lib/fba-local/fulfillment");
  const reservation = { requestedQty: 5, releasedQty: 0, dispatchedQty: 0, pickedQty: 0 };
  const summary = (change = {}, extra: Array<{quantity: number; reservation: null}> = []) => planFulfillment("ACTIVE", [{ quantity: 5, reservation: { ...reservation, ...change } }, ...extra]);
  assert.equal(summary().stage, "AWAITING_PICK");
  assert.equal(summary({}, [{quantity: 2, reservation: null}]).stage, "PARTIALLY_RESERVED");
  assert.equal(summary({pickedQty: 2}).stage, "PARTIALLY_PICKED");
  assert.equal(summary({pickedQty: 5}).stage, "AWAITING_DISPATCH");
  assert.equal(summary({dispatchedQty: 2}).stage, "PARTIALLY_DISPATCHED");
  assert.equal(summary({dispatchedQty: 5}).stage, "DISPATCHED");
  assert.equal(summary({releasedQty: 1, dispatchedQty: 4}).stage, "SHORTFALL");
  assert.equal(summary({releasedQty: 5}).stage, "RELEASED");
  assert.equal(planFulfillment("CANCELLED", [{quantity: 5, reservation: null}]).stage, "CANCELLED");
  const total = summary({pickedQty: 1, dispatchedQty: 2, releasedQty: 1}, [{quantity: 2, reservation: null}]);
  assert.equal(total.plannedQty, total.unreservedQty + total.reservedQty + total.dispatchedQty + total.releasedQty);
  assert.equal(total.reservedQty, total.pickedQty + total.unpickedQty);
});
