import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { rawArchiveManifest, rawReportEnvelope, rawResponseEnvelope } from "../src/lib/amazon-sync/raw-fields";
import { recordReportParseEvidence } from "../src/lib/amazon-sync/report-parse-evidence";
import { responseArchiveHashMatches } from "../src/lib/amazon-sync/response-evidence";
import { digest } from "../src/lib/amazon-sync/approval-policy";

test("response replay accepts both saved archive generations but rejects altered source text", () => {
  const raw = '{ "amount":9007199254740993.01,"label":"原件" }';
  for (const hash of [createHash("sha256").update(raw).digest("hex"), digest(raw)]) {
    assert.equal(responseArchiveHashMatches(raw, hash), true);
    assert.equal(responseArchiveHashMatches(raw + " ", hash), false);
    assert.equal(responseArchiveHashMatches(JSON.stringify(JSON.parse(raw)), hash), false);
  }
});

test("archive manifest measures original UTF-8 source rather than parsed JSON", () => {
  const raw = '{"label":"原件","amount":9007199254740993.01}';
  const manifest = rawArchiveManifest(raw);
  assert.equal(manifest.byteLength, Buffer.byteLength(raw, "utf8"));
  assert.equal(manifest.sha256, createHash("sha256").update(raw).digest("hex"));
  assert.equal(manifest.parserVersion, null);
  assert.equal(manifest.officialSchemaVersion, null);
  assert.equal(manifest.parseStatus, "NOT_PARSED");
  assert.equal(rawReportEnvelope(raw).rawText, raw);
  assert.equal(rawResponseEnvelope(raw).rawBody, raw);
  assert.notEqual(rawArchiveManifest(JSON.stringify(JSON.parse(raw))).sha256, manifest.sha256);
});

test("parser checkpoints bind same-source raw evidence and retain earlier events", async () => {
  const events: Array<{ metadata: Prisma.JsonObject }> = [];
  let rawPresent = true;
  const tx = {
    amazonSyncRawPage: { findFirst: async (args: { where: { organizationId: string; workspaceId: string; task: { sourceId: string } } }) => {
      assert.equal(args.where.organizationId, "fixture-org");
      assert.equal(args.where.workspaceId, "fixture-workspace");
      assert.equal(args.where.task.sourceId, "source");
      return rawPresent ? { bodySha256: "a".repeat(64), capturedAt: new Date("2026-11-09T00:00:00Z") } : null;
    } },
    auditLog: { create: async ({ data }: { data: { metadata: Prisma.JsonObject } }) => { events.push(data); return data; } },
  } as unknown as Prisma.TransactionClient;
  const run = { id: "task", sourceId: "source", organizationId: "fixture-org", workspaceId: "fixture-workspace", resource: "inventory_events", requestedByUserId: "actor" } as AmazonSyncRun;
  const input = { rawTaskId: "archive-task", rawPage: 1, rowsCommitted: 0, checkedAt: new Date("2026-11-09T01:00:00Z") };
  await recordReportParseEvidence(tx, run, { ...input, phase: "ARCHIVED" });
  await recordReportParseEvidence(tx, run, { ...input, phase: "ROWS_COMMITTED", rowsCommitted: 500, totalRows: 600 });
  await recordReportParseEvidence(tx, run, { ...input, phase: "ATTEMPT_FAILED", rowsCommitted: 500, failureCode: "INVENTORY_EVENTS_VALIDATION" });
  assert.deepEqual(events.map(event => event.metadata.phase), ["ARCHIVED", "ROWS_COMMITTED", "ATTEMPT_FAILED"]);
  assert.equal(events[0].metadata.rowsCommitted, 0);
  assert.equal(events[2].metadata.rawSha256, "a".repeat(64));
  assert.equal(events[2].metadata.published, false);
  assert.equal("rawText" in events[0].metadata, false);
  rawPresent = false;
  await assert.rejects(recordReportParseEvidence(tx, run, { ...input, phase: "PUBLISHED" }), /原件/);
  await assert.rejects(recordReportParseEvidence(tx, run, { ...input, phase: "ROWS_COMMITTED", rowsCommitted: 5, totalRows: 4 }), /计数/);
  assert.equal(events.length, 3);
});


test("orders checkpoints identify API/schema/row grain and reject mismatched originals", async () => {
  const events: Prisma.JsonObject[] = [];
  const requestMetadata: Prisma.JsonObject = { apiVersion: "2026-01-01", operation: "getOrder" };
  const tx = {
    amazonSyncRawPage: { findFirst: async () => ({ bodySha256: "b".repeat(64), capturedAt: new Date("2026-11-09T00:00:00Z"), requestMetadata }) },
    auditLog: { create: async ({ data }: { data: { metadata: Prisma.JsonObject } }) => { events.push(data.metadata); } },
  } as unknown as Prisma.TransactionClient;
  const run = { id: "task", sourceId: "source", organizationId: "fixture-org", workspaceId: "fixture-workspace", resource: "orders", requestedByUserId: "actor" } as AmazonSyncRun;
  const input = { rawTaskId: "task", rawPage: 1001, rowsCommitted: 2, totalRows: 2, checkedAt: new Date(), phase: "ROWS_COMMITTED" as const, replayed: true };
  await recordReportParseEvidence(tx, run, input);
  assert.equal(events[0].parserVersion, "orders.2026-01-01.v2");
  assert.equal(events[0].schemaVersion, "orders.non-pii.v2");
  assert.equal(events[0].officialSchemaVersion, null);
  assert.equal(events[0].rowKind, "ORDER_ITEM");
  assert.equal(events[0].replayed, true);
  requestMetadata.operation = "searchOrders";
  await recordReportParseEvidence(tx, run, { ...input, rawPage: 1, replayed: false });
  assert.equal(events[1].rowKind, "ORDER");
  requestMetadata.operation = "getMarketplaceParticipations";
  await assert.rejects(recordReportParseEvidence(tx, run, input), /API/);
  requestMetadata.operation = "getOrder"; requestMetadata.apiVersion = "v0";
  await assert.rejects(recordReportParseEvidence(tx, run, input), /版本/);
  assert.equal(events.length, 2);
});
