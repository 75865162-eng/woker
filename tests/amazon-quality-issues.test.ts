import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import { qualityIssueId, recordReportQualityIssue } from "../src/lib/amazon-sync/quality-issues";

const scope = { organizationId: "fixture-org", workspaceId: "fixture-workspace" };
test("quality issue identity remains report-scoped and tenant-isolated", () => {
  const id = qualityIssueId(scope, "source", "report", "CURRENCY_MISSING");
  assert.equal(id, qualityIssueId(scope, "source", "report", "CURRENCY_MISSING"));
  assert.notEqual(id, qualityIssueId({ ...scope, workspaceId: "other" }, "source", "report", "CURRENCY_MISSING"));
  assert.notEqual(id, qualityIssueId(scope, "source", "report-2", "CURRENCY_MISSING"));
  assert.notEqual(id, qualityIssueId(scope, "source", "report", "SKU_ATTRIBUTION_PENDING"));
});

test("checks append discovery, resolution and reopening while preserving first detection", async () => {
  const events: Array<{ metadata: Prisma.JsonObject }> = [];
  const tx = {
    amazonSyncDataSource: { findFirstOrThrow: async () => ({ sellerAccountId: "seller", marketplaceId: "site", resource: "settlements", authorizationId: "auth", authorization: { revision: 3 } }) },
    auditLog: { findFirst: async () => events.at(-1) ?? null, create: async ({ data }: { data: { metadata: Prisma.JsonObject } }) => { events.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const input = { sourceId: "source", taskId: "task", reportId: "report", code: "CURRENCY_MISSING" as const, affectedRows: 0, affectedFields: ["currencyCode"], rawSha256: "a".repeat(64), checkedAt: new Date("2026-11-09T10:00:00Z") };
  await recordReportQualityIssue(tx, scope, "actor", input);
  assert.equal(events.length, 0, "clean reports do not manufacture a resolved issue");
  await recordReportQualityIssue(tx, scope, "actor", { ...input, affectedRows: 2 });
  await recordReportQualityIssue(tx, scope, "actor", { ...input, checkedAt: new Date("2026-11-09T11:00:00Z") });
  await recordReportQualityIssue(tx, scope, "actor", { ...input, affectedRows: 1, checkedAt: new Date("2026-11-09T12:00:00Z") });
  assert.deepEqual(events.map(e => e.metadata.status), ["OPEN", "RESOLVED", "OPEN"]);
  assert.equal(events[0].metadata.firstDetectedAt, events[2].metadata.firstDetectedAt);
  assert.ok(events[1].metadata.resolutionEvidence);
  assert.equal(events[2].metadata.resolvedAt, null);
  assert.equal(events[0].metadata.affectedRows, 2, "resolution does not rewrite discovery");
});
