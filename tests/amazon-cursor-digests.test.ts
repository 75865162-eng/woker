import assert from "node:assert/strict";
import test from "node:test";
import { domainReportHistoryCursorDigest } from "@/lib/amazon-sync/domain-reports";
import { financeCursorDigest } from "@/lib/amazon-sync/finance";
import { orderCursorDigest } from "@/lib/amazon-sync/orders";
import { returnCursorDigest } from "@/lib/amazon-sync/returns";

const common = {
  id: "cursor",
  activeRunId: "run",
  status: "SUCCEEDED",
  watermarkFrom: new Date("2026-01-01T00:00:00.000Z"),
  watermarkTo: new Date("2026-01-02T00:00:00.000Z"),
  reportStateCiphertext: null,
  nextTokenCiphertext: null,
  detailPolicyDigest: null,
  listComplete: true,
};

test("cursor digests bind both watermarks for every replay domain", () => {
  const changed = { ...common, watermarkTo: new Date("2026-01-02T00:00:01.000Z") };
  assert.notEqual(domainReportHistoryCursorDigest(common), domainReportHistoryCursorDigest(changed));
  assert.notEqual(financeCursorDigest(common), financeCursorDigest(changed));
  assert.notEqual(returnCursorDigest(common), returnCursorDigest(changed));
  assert.notEqual(orderCursorDigest(common), orderCursorDigest(changed));
});
