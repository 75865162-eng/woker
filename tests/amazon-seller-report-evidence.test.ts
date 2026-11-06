import test from "node:test";
import assert from "node:assert/strict";
import { distinctSellerEvidence, localSellerEvidenceEnabled, readSellerReportEvidence } from "@/lib/amazon-sync/seller-report-evidence";
test("seller evidence deduplicates content only within the same authorization and seller", () => {
  const base = { authorizationId: "auth", amazonSellerId: "seller", contentSha256: "hash" };
  const rows = [{ ...base, id: "first" }, { ...base, id: "duplicate" }, { ...base, id: "other-seller", amazonSellerId: "other" }, { ...base, id: "other-auth", authorizationId: "other" }, { ...base, id: "different-content", contentSha256: "different" }];
  assert.deepEqual(distinctSellerEvidence(rows).map(r => r.id), ["first", "other-seller", "other-auth", "different-content"]);
});
test("seller evidence capability stays disabled outside the approved local target", () => {
  assert.equal(localSellerEvidenceEnabled({ organizationId: "fixture", workspaceId: "default" }), false);
});
test("seller evidence rejects a foreign scope before database or raw access", async () => {
  await assert.rejects(readSellerReportEvidence({ organizationId: "fixture", workspaceId: "default" }, new URLSearchParams({ resource: "inventory_events" }), "fixture-actor"), /仅限已批准/);
});
