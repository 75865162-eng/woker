import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { seal, normalizeCommand } from "../src/lib/amazon-sync/approval-policy";
import { encryptCheckpoint } from "../src/lib/amazon-sync/checkpoint";
import { parseDomainReport } from "../src/lib/amazon-sync/domain-reports";
import { previewReportArchiveRecovery } from "../src/lib/amazon-sync/report-archive-recovery";

test("failed report reuses only the exact authorized window and authenticated original", async () => {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 76).toString("base64");
  const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
  const frozen = { sourceRevision: 3, authorizationId: "auth", authorizationRevision: 2, sellerAccountId: "seller", marketplaceId: "site", amazonSellerId: "amazon-seller", reportWindow: { from: "2026-11-08", to: "2026-11-08" } };
  const cursor = { id: "cursor", activeRunId: "failed", status: "FAILED", watermarkFrom: new Date("2026-11-08T00:00:00Z"), watermarkTo: new Date("2026-11-08T23:59:59Z"), reportStateCiphertext: encryptCheckpoint(JSON.stringify({ reportId: "fatal-report" }), scope, "cursor") };
  const source = { id: "source", resource: "reimbursements", revision: 3, authorizationId: "auth", sellerAccountId: "seller", marketplaceId: "site", authorization: { revision: 2, amazonSellerId: "amazon-seller" }, resourceCursor: cursor };
  const run = { id: "failed", status: "FAILED", pagesCompleted: 0, processedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0, leaseOwner: null, leaseExpiresAt: null, frozenScope: frozen, checkpointCiphertext: "retained" };
  const rawText = "approval-date\treimbursement-id\tcurrency-unit\tamount-total\n2026-11-08T01:00:00Z\tfixture-id\tUSD\t4.71\n";
  const hash = createHash("sha256").update(rawText).digest("hex");
  const document = { id: "doc", sourceRunId: "owner", reportId: "done-report", reportType: "GET_FBA_REIMBURSEMENTS_DATA", contentSha256: hash, rowCount: 1, status: "STAGED", task: { status: "SUCCEEDED", paginationComplete: true, stage: "ARCHIVED_SITE_PENDING", frozenScope: structuredClone(frozen) } };
  const raw = { taskId: "owner", page: 1, bodySha256: hash, rawCiphertext: seal({ rawText }, scope, "owner:1", "amazon-reimbursements-raw.v1"), requestMetadata: { reportId: "done-report", documentId: "amazon-document", reportType: document.reportType, marketplaceId: "site", operation: "getReportDocument", apiVersion: "2021-06-30" } };
  const tx = { amazonSyncDataSource: { findFirstOrThrow: async () => source }, amazonSyncRun: { findFirstOrThrow: async () => run, count: async () => 0 }, amazonSyncReportRow: { findMany: async () => parseDomainReport("reimbursements", rawText).rows }, amazonSyncSchedule: { count: async () => 0 }, amazonSyncRawPage: { count: async () => 0, findFirstOrThrow: async () => raw }, amazonSyncReportDocument: { findFirstOrThrow: async () => document } } as unknown as Prisma.TransactionClient;
  const result = await previewReportArchiveRecovery(tx, scope, "source", "failed", "doc");
  assert.equal(result.manifest.rows, 1);
  assert.equal(result.manifest.amazonRequests, 0);
  assert.equal(result.manifest.failedReportId, "fatal-report");
  assert.equal(result.manifest.published, false);
  document.task.frozenScope.reportWindow.from = "2026-11-07";
  await assert.rejects(() => previewReportArchiveRecovery(tx, scope, "source", "failed", "doc"), /窗口/);
  document.task.frozenScope = structuredClone(frozen);
  raw.rawCiphertext = seal({ rawText: rawText + "tampered" }, scope, "owner:1", "amazon-reimbursements-raw.v1");
  await assert.rejects(() => previewReportArchiveRecovery(tx, scope, "source", "failed", "doc"), /摘要/);
});

test("archive reuse is a separate approved recovery mode", () => {
  assert.equal(normalizeCommand({ action: "recover-report", archiveOnly: true, reportDocumentId: "doc" }).reportDocumentId, "doc");
  for (const patch of [{ archiveOnly: "true" }, { attributionOnly: true }, { inboundItemsOnly: true }, { reportWindow: {} }]) assert.throws(() => normalizeCommand({ action: "recover-report", archiveOnly: true, ...patch }));
});
