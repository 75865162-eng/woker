import assert from "node:assert/strict";
import test from "node:test";
import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { digest } from "../src/lib/amazon-sync/approval-policy";
import { inspectReportRecovery } from "../src/lib/amazon-sync/report-checkpoint-recovery";

function fixture() {
  const frozen = { sourceRevision: 2, authorizationId: "auth", authorizationRevision: 3, sellerAccountId: "seller", marketplaceId: "ATVPDKIKX0DER", amazonSellerId: "amazon-seller", reportWindow: { from: "2026-11-01", to: "2026-11-02" } };
  const run = { id: "task", organizationId: "fixture", workspaceId: "fixture", sourceId: "source", resource: "reimbursements", status: "PAUSED", stage: "WAITING", frozenScope: frozen, frozenScopeDigest: digest(frozen), checkpointCiphertext: null, pagesCompleted: 0, processedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0 } as unknown as AmazonSyncRun;
  let rawCount = 0;
  const source = { id: "source", enabled: true, resource: run.resource, revision: 2, authorizationId: "auth", sellerAccountId: "seller", marketplaceId: "ATVPDKIKX0DER", authorization: { status: "CONFIGURED", revision: 3, amazonSellerId: "amazon-seller" }, resourceCursor: null as unknown };
  const tx = { amazonSyncDataSource: { findFirst: async () => source }, amazonSyncRawPage: { count: async () => rawCount } } as unknown as Prisma.TransactionClient;
  return { run, tx, source, setRawCount: (value: number) => { rawCount = value; } };
}

test("a paused report before the first request remains recoverable without inventing a cursor", async () => {
  const f = fixture();
  const evidence = await inspectReportRecovery(f.tx, f.run);
  assert.equal(evidence.mode, "RESUME_FROZEN_REPORT_REQUEST");
  assert.equal(evidence.archivedDocumentReused, false);
  f.setRawCount(1);
  await assert.rejects(() => inspectReportRecovery(f.tx, f.run), /检查点/);
});

test("progress without a report cursor cannot silently restart collection", async () => {
  const f = fixture(); f.run.processedCount = 500;
  await assert.rejects(() => inspectReportRecovery(f.tx, f.run), /检查点/);
});

test("report cursor windows and seller identities must match the original approved request", async () => {
  const f = fixture();
  const cursor = { id: "cursor", organizationId: "fixture", workspaceId: "fixture", activeRunId: "task", resource: "reimbursements", reportStateCiphertext: null, amazonSellerId: "amazon-seller", marketplaceId: "ATVPDKIKX0DER", watermarkFrom: new Date("2026-10-01T00:00:00Z"), watermarkTo: new Date("2026-11-02T23:59:59Z") };
  f.source.resourceCursor = cursor;
  await assert.rejects(() => inspectReportRecovery(f.tx, f.run), /检查点/);
  cursor.watermarkFrom = new Date("2026-11-01T00:00:00Z"); cursor.amazonSellerId = "other-seller";
  await assert.rejects(() => inspectReportRecovery(f.tx, f.run), /检查点/);
});
