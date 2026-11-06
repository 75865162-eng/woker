import test from "node:test";
import assert from "node:assert/strict";
import { hasCompleteReportAttributionProof, recoveredReportAttributionProof, resolveReportRowAttribution } from "@/lib/amazon-sync/report-row-attribution";
import { normalizeCommand } from "@/lib/amazon-sync/approval-policy";
import type { Prisma } from "@prisma/client";
import { previewReportAttribution } from "@/lib/amazon-sync/report-attribution-recovery";
const us = "ATVPDKIKX0DER", ca = "A2EUQ1WTGCTBG2", sites = [us, ca];
test("reconciliation only opens the source gate for complete verified report evidence", () => {
  assert.equal(hasCompleteReportAttributionProof(recoveredReportAttributionProof(1, 90, 0)), true);
  assert.equal(hasCompleteReportAttributionProof(recoveredReportAttributionProof(1, 89, 1)), false);
  assert.equal(hasCompleteReportAttributionProof(recoveredReportAttributionProof(0, 0, 0)), false);
  assert.equal(hasCompleteReportAttributionProof(recoveredReportAttributionProof(1, 0, 0)), true);
  for (const proof of [null, [], {}, { status: "VERIFIED", version: "explicit-report-row.v1" }, { status: "VERIFIED", version: "explicit-report-row.v1", complete: false }, { status: "VERIFIED", version: "old", complete: true }]) {
    assert.equal(hasCompleteReportAttributionProof(proof), false);
  }
});
test("audited attribution recovery is separate from window and collection changes", () => {
  assert.equal(normalizeCommand({ action: "recover-report", id: "fixture", attributionOnly: true }).attributionOnly, true);
  assert.throws(() => normalizeCommand({ action: "recover-report", id: "fixture", attributionOnly: "true" }));
  assert.throws(() => normalizeCommand({ action: "recover-report", id: "fixture", attributionOnly: true, reportWindow: {} }));
});
test("attribution preview binds report and cursor evidence and rejects active execution", async () => {
  let active = 0;
  const source = { id: "s", revision: 2, resource: "inventory_events", authorization: { revision: 3 }, resourceCursor: { offset: 500 } };
  const tx = { amazonSyncDataSource: { findFirstOrThrow: async () => source }, amazonSyncRun: { count: async () => active }, amazonSyncSchedule: { count: async () => 0 }, amazonSyncReportDocument: { findMany: async () => [{ id: "document", status: "STAGED", contentSha256: "digest", rowCount: 5 }] } } as unknown as Prisma.TransactionClient;
  const scope = { organizationId: "fixture", workspaceId: "default" };
  const before = JSON.stringify(source);
  const p = await previewReportAttribution(tx, scope, "s");
  assert.equal(JSON.stringify(source), before);
  source.resourceCursor.offset = 1000;
  assert.notEqual((await previewReportAttribution(tx, scope, "s")).recoveryDigest, p.recoveryDigest);
  active = 1;
  await assert.rejects(previewReportAttribution(tx, scope, "s"), /暂停/);
});
test("report attribution never infers a sales site from warehouse country, SKU or currency", () => {
  assert.deepEqual(resolveReportRowAttribution({ fields: { country: "US", sku: "fixture-us", "currency-unit": "USD", store: "" }, orderId: null }, sites), { status: "MISSING_EVIDENCE" });
});
test("explicit store identity or verified same-scope order evidence can confirm attribution", () => {
  assert.deepEqual(resolveReportRowAttribution({ fields: { store: "Amazon.ca", country: "US" }, orderId: null }, sites), { status: "VERIFIED", marketplaceId: ca });
  assert.deepEqual(resolveReportRowAttribution({ fields: {}, orderId: "fixture-order" }, sites, [us, us]), { status: "VERIFIED", marketplaceId: us });
  assert.deepEqual(resolveReportRowAttribution({ fields: {}, orderId: null }, sites, [us]), { status: "MISSING_EVIDENCE" });
});
test("conflicting store and order evidence, unknown stores and unapproved sites remain isolated", () => {
  assert.deepEqual(resolveReportRowAttribution({ fields: { store: "Amazon.ca" }, orderId: "fixture-order" }, sites, [us]), { status: "CONFLICTING_EVIDENCE" });
  assert.deepEqual(resolveReportRowAttribution({ fields: { store: "Unverified" }, orderId: "fixture-order" }, sites, [us]), { status: "CONFLICTING_EVIDENCE" });
  assert.deepEqual(resolveReportRowAttribution({ fields: { "marketplace-id": ca }, orderId: null }, [us]), { status: "OUT_OF_SCOPE" });
});

test('report summary rejects warehouse-only and cross-site evidence', async () => {
  const { reportAttributionSummary, reportVerifiedRowWhere }=await import('@/lib/amazon-sync/report-row-attribution');
  const rows: Array<{fields: Record<string,string>;orderId: string|null}>=[{fields:{store:'Amazon.com'},orderId:null},{fields:{country:'US'},orderId:null},{fields:{store:'Amazon.ca'},orderId:null}];
  assert.deepEqual(reportAttributionSummary(rows,us),{verified:1,missing:1,conflicting:0,outside:1,complete:false});
  assert.equal(reportAttributionSummary([rows[0]],us).complete,true);
  const where=JSON.stringify(reportVerifiedRowWhere('inventory_events',us));
  assert.ok(where.includes('VERIFIED'));assert.ok(where.includes(us));
  assert.deepEqual(reportVerifiedRowWhere('inventory_age',us),{});
});
