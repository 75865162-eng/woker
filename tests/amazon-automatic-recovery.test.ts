import assert from "node:assert/strict";
import test from "node:test";
import type { AmazonSyncResourceCursor, AmazonSyncRun } from "@prisma/client";
import { automaticRecoveryCursorIsCurrent } from "@/lib/amazon-sync/automatic-recovery";
import { domainReportHistoryCursorDigest } from "@/lib/amazon-sync/domain-reports";
import { financeCursorDigest } from "@/lib/amazon-sync/finance";
import { orderCursorDigest } from "@/lib/amazon-sync/orders";
import { returnCursorDigest } from "@/lib/amazon-sync/returns";

const cursor = (resource: string): AmazonSyncResourceCursor => ({
  id: "cursor", organizationId: "org", workspaceId: "workspace", sourceId: "source", resource,
  amazonSellerId: "seller", marketplaceId: "marketplace", watermarkFrom: new Date("2026-01-01T00:00:00Z"), watermarkTo: new Date("2026-01-02T00:00:00Z"),
  status: "SUCCEEDED", activeRunId: "forward-run", lastSuccessAt: new Date("2026-01-02T00:00:00Z"), reportStateCiphertext: null,
  nextTokenCiphertext: null, detailPolicyDigest: null, listComplete: true, updatedAt: new Date("2026-01-02T00:00:00Z"),
} as AmazonSyncResourceCursor);

function replayRun(resource: string, frozenKey: string, digestKey: string, cursorValue: AmazonSyncResourceCursor) {
  const run = { id: "replay-run", resource, pagesCompleted: 1, frozenScope: { [frozenKey]: true, [digestKey]: "" }, summary: {} } as unknown as AmazonSyncRun;
  const value = { ...run, frozenScope: { [frozenKey]: true, [digestKey]: "" } };
  const expected = resource === "finance" ? financeCursorDigest(cursorValue)
    : resource === "returns" ? returnCursorDigest(cursorValue)
      : resource === "orders" ? orderCursorDigest(cursorValue)
        : domainReportHistoryCursorDigest(cursorValue);
  return { ...value, frozenScope: { [frozenKey]: true, [digestKey]: expected } } as unknown as Parameters<typeof automaticRecoveryCursorIsCurrent>[0];
}

test("automatic recovery keeps history replay only while its shared forward cursor is unchanged", () => {
  const cases = [
    ["finance", "financeHistoryReplay", "financeHistoryCursorDigest"],
    ["returns", "returnHistoryReplay", "returnHistoryCursorDigest"],
    ["reimbursements", "reimbursementHistoryReplay", "reimbursementHistoryCursorDigest"],
    ["inventory_events", "inventoryEventHistoryReplay", "inventoryEventHistoryCursorDigest"],
  ] as const;
  for (const [resource, replayKey, digestKey] of cases) {
    const current = cursor(resource), run = replayRun(resource, replayKey, digestKey, current);
    assert.equal(automaticRecoveryCursorIsCurrent(run, current), true, resource);
    assert.equal(automaticRecoveryCursorIsCurrent(run, { ...current, watermarkTo: new Date(current.watermarkTo.getTime() + 1000) }), false, resource);
  }

  const orderCursor = cursor("orders"), orderRun = replayRun("orders", "orderHistoryReplay", "orderCursorDigest", orderCursor);
  const orderWithCheckpoint = { ...orderRun, summary: { coverage: { cursorDigest: orderCursorDigest(orderCursor) } } } as unknown as Parameters<typeof automaticRecoveryCursorIsCurrent>[0];
  assert.equal(automaticRecoveryCursorIsCurrent(orderWithCheckpoint, orderCursor), true);
  assert.equal(automaticRecoveryCursorIsCurrent(orderWithCheckpoint, { ...orderCursor, watermarkTo: new Date(orderCursor.watermarkTo.getTime() + 1000) }), false);

  const ordinary = { id: "ordinary", resource: "inventory", frozenScope: {}, summary: {}, pagesCompleted: 1 } as unknown as Parameters<typeof automaticRecoveryCursorIsCurrent>[0];
  assert.equal(automaticRecoveryCursorIsCurrent(ordinary, cursor("inventory")), false);
});
