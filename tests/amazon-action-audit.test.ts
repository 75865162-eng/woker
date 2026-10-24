import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { previewAmazonAction, confirmAmazonAction, applyAmazonAction } from "@/lib/agent-platform/amazon-action-audit";
import { buildAmazonAdsExecutionPlan } from "@/lib/agent-platform/amazon-ads";
import { actionDigest, validateBidPlan } from "@/lib/agent-platform/amazon-action-policy";
import { sponsoredProductsBidRequest, mapAmazonAdsError, assertAmazonAdsTransportImplemented } from "@/lib/amazon/ads-client";

type Row = Record<string, unknown>;
// Transactional in-memory integration double: service uses the same delegates as Prisma.
// Deliberately does not replace real PostgreSQL lock/constraint acceptance.
function database() {
  let tables: Record<string, Row[]> = { workspaceScope: [{ organizationId: "org", id: "ws" }, { organizationId: "org", id: "other" }], agentDefinition: [{ id: "ppc", organizationId: "org", enabled: true }] };
  let serial = Promise.resolve(); let rejectAuditCreate = false;
  function matches(row: Row, where: Row = {}): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "organizationId_id" || key === "organizationId_workspaceId_idempotencyKey") return matches(row, value as Row);
      if (key === "execution") return matches(tables.agentExecution?.find((execution) => execution.id === row.executionId) ?? {}, value as Row);
      return row[key] === value;
    });
  }
  const tx = new Proxy({}, { get: (_, table: string) => {
    if (table === "$executeRaw") return async () => 0;
    return new Proxy({}, { get: (_, method: string) => async (args: { where?: Row; data?: Row; include?: Row }) => {
      const rows = tables[table] ??= [];
      let row = rows.find((candidate) => matches(candidate, args.where));
      if (method === "create") {
        if (table === "amazonAgentActionAudit" && rejectAuditCreate) throw new Error("injected audit insert failure");
        row = { id: `${table}-${rows.length}`, createdAt: new Date(), updatedAt: new Date(), confirmedAt: null, ...structuredClone(args.data) }; rows.push(row); return structuredClone(row);
      }
      if (method === "updateMany") {
        let count = 0; for (const item of rows) if (matches(item, args.where)) { Object.assign(item, structuredClone(args.data)); count++; } return { count };
      }
      if (method === "update") { assert.ok(row, `${table} update row missing`); Object.assign(row, structuredClone(args.data)); return structuredClone(row); }
      if (method === "findFirst" && table === "agentExecutionTrace") return structuredClone(rows.filter((candidate) => matches(candidate, args.where)).sort((a, b) => Number(b.sequence) - Number(a.sequence))[0] ?? null);
      if (method === "findUniqueOrThrow" || method === "findFirstOrThrow") assert.ok(row, `${table} find row missing`);
      if (args.include && row && table === "agentExecution") row = { ...row, tasks: tables.agentTask?.filter((task) => task.executionId === row!.id) ?? [], approvals: tables.agentApproval?.filter((approval) => approval.executionId === row!.id) ?? [], traces: [], toolCalls: [], events: [] };
      if (["findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow"].includes(method)) return structuredClone(row ?? null);
      throw new Error(`Unexpected delegate ${table}.${method}`);
    } });
  } });
  const db = { $transaction: async (fn: (client: unknown) => Promise<unknown>) => {
    const previous = serial; let release!: () => void; serial = new Promise<void>((resolve) => { release = resolve; }); await previous;
    const snapshot = structuredClone(tables);
    try { return await fn(tx); } catch (error) { tables = snapshot; throw error; } finally { release(); }
  } } as unknown as PrismaClient;
  return { db, tables: () => tables, failAudit: () => { rejectAuditCreate = true; } };
}
const scope = { organizationId: "org", workspaceId: "ws", actorUserId: "actor" };
const now = new Date("2026-10-24T00:00:00Z");
const input = { report: { bidRecommendations: [{ rowId: "row-1", currentBid: 1, suggestedBid: 1.1 }] }, adjustmentDrafts: [], idempotencyKey: "preview-key-0001" };

test("preview → confirm → disabled apply persists old/new, approval and idempotent dry run with no HTTP", async () => {
  const original = process.env.AMAZON_ADS_EXECUTION_ENABLED; const fetcher = globalThis.fetch;
  process.env.AMAZON_ADS_EXECUTION_ENABLED = "false"; let external = 0;
  globalThis.fetch = async () => { external++; throw new Error("external HTTP forbidden"); };
  try {
    const { db, tables } = database();
    const preview = await previewAmazonAction(scope, input, db, now);
    assert.equal(preview.audit.status, "PREVIEW"); assert.equal(preview.approval.status, "REQUESTED");
    assert.deepEqual(preview.audit.oldValues, [{ target: "row-1", bid: 1, source: "submitted_report_unverified" }]);
    assert.equal(preview.audit.expiresAt?.getTime(), now.getTime() + 30 * 60000);
    const replay = await previewAmazonAction(scope, input, db, now); assert.equal(replay.audit.id, preview.audit.id);
    await assert.rejects(() => applyAmazonAction(scope, preview.audit.id, input.idempotencyKey, db, now), { code: "APPROVAL_REQUIRED" });
    const confirmed = await confirmAmazonAction({ ...scope, actorUserId: "approver" }, preview.approval.id, "APPROVED", "reviewed", db, now);
    assert.equal(confirmed.audit.status, "PREVIEW"); assert.ok(confirmed.audit.confirmedAt);
    await assert.rejects(() => confirmAmazonAction(scope, preview.approval.id, "APPROVED", "again", db, now), { code: "ALREADY_RESOLVED" });
    const applied = await applyAmazonAction(scope, preview.audit.id, input.idempotencyKey, db, now);
    assert.equal((applied.execution as Row).status, "DRY_RUN_BLOCKED"); assert.equal(applied.audit.status, "PREVIEW");
    const repeat = await applyAmazonAction(scope, preview.audit.id, input.idempotencyKey, db, now); assert.equal(repeat.replayed, true);
    assert.equal(tables().amazonAgentActionAudit.length, 1); assert.equal(external, 0);
    assert.equal(tables().agentEvent[0].eventType, "approval.result");
    assert.equal(tables().agentToolCall.length, 1);
    assert.equal(tables().agentToolCall[0].toolId, "amazon.ads.recommendation.apply");
    assert.equal((tables().agentExecution[0].output as Row).state, "dry_run");
  } finally { globalThis.fetch = fetcher; if (original === undefined) delete process.env.AMAZON_ADS_EXECUTION_ENABLED; else process.env.AMAZON_ADS_EXECUTION_ENABLED = original; }
});
test("enabled apply fails whole batch NOT_IMPLEMENTED, records error, never sends HTTP or marks APPLIED", async () => {
  const original = process.env.AMAZON_ADS_EXECUTION_ENABLED; const fetcher = globalThis.fetch;
  process.env.AMAZON_ADS_EXECUTION_ENABLED = "true"; let external = 0;
  globalThis.fetch = async () => { external++; throw new Error("HTTP forbidden"); };
  try {
    const { db, tables } = database(); const preview = await previewAmazonAction(scope, input, db, now);
    const confirmed = await confirmAmazonAction(scope, preview.approval.id, "APPROVED", "reviewed", db, now); assert.equal(confirmed.audit.status, "CONFIRMED");
    const results = await Promise.all([applyAmazonAction(scope, preview.audit.id, input.idempotencyKey, db, now), applyAmazonAction(scope, preview.audit.id, input.idempotencyKey, db, now)]);
    assert.equal(results[0].audit.status, "FAILED"); assert.equal((results[0].execution as Row).code, "NOT_IMPLEMENTED");
    assert.equal((results[0].execution as Row).externalWriteAttempted, false); assert.equal(results[1].replayed, true);
    assert.equal(tables().agentExecution[0].status, "FAILED"); assert.equal(external, 0);
  } finally { globalThis.fetch = fetcher; if (original === undefined) delete process.env.AMAZON_ADS_EXECUTION_ENABLED; else process.env.AMAZON_ADS_EXECUTION_ENABLED = original; }
});
test("audit scope, approval binding, expiry, rejected decisions and request digest are enforced", async () => {
  const { db, tables } = database(); const preview = await previewAmazonAction(scope, input, db, now);
  await assert.rejects(() => previewAmazonAction(scope, { ...input, report: { bidRecommendations: [{ rowId: "row-1", currentBid: 1, suggestedBid: 2 }] } }, db, now), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(() => previewAmazonAction({ ...scope, actorUserId: "someone" }, input, db, now), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(() => applyAmazonAction({ ...scope, organizationId: "other-org" }, preview.audit.id, input.idempotencyKey, db, now), { code: "WORKSPACE_NOT_FOUND" });
  await assert.rejects(() => applyAmazonAction({ ...scope, workspaceId: "other" }, preview.audit.id, input.idempotencyKey, db, now), { code: "AUDIT_NOT_FOUND" });
  await assert.rejects(() => confirmAmazonAction({ ...scope, workspaceId: "other" }, preview.approval.id, "APPROVED", "", db, now), { code: "APPROVAL_NOT_FOUND" });
  await assert.rejects(() => confirmAmazonAction(scope, preview.approval.id, "APPROVED", "", db, new Date(now.getTime() + 30 * 60000)), { code: "EXPIRED" });
  await confirmAmazonAction(scope, preview.approval.id, "REJECTED", "reject", db, now);
  assert.equal(tables().amazonAgentActionAudit[0].status, "REJECTED");
  await assert.rejects(() => applyAmazonAction(scope, preview.audit.id, input.idempotencyKey, db, now), { code: "APPROVAL_REQUIRED" });
});
test("approved apply also checks expiry and idempotency; preview creation rolls back with failed audit insert", async () => {
  const { db } = database(); const preview = await previewAmazonAction(scope, input, db, now);
  await confirmAmazonAction(scope, preview.approval.id, "APPROVED", "", db, now);
  await assert.rejects(() => applyAmazonAction(scope, preview.audit.id, "different-key", db, now), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(() => applyAmazonAction(scope, preview.audit.id, input.idempotencyKey, db, new Date(now.getTime() + 31 * 60000)), { code: "EXPIRED" });
  const broken = database(); broken.failAudit(); await assert.rejects(() => previewAmazonAction(scope, input, broken.db, now), /injected/);
  assert.equal(broken.tables().agentExecution, undefined); assert.equal(broken.tables().agentApproval, undefined);
});
test("hard batch/bid limits, duplicates, unsupported operations and large delta warnings", () => {
  const make = (bids: unknown[]) => buildAmazonAdsExecutionPlan({ report: { bidRecommendations: bids }, adjustmentDrafts: [], clock: () => now });
  assert.throws(() => validateBidPlan(make([])), { code: "INVALID_BATCH" });
  assert.throws(() => validateBidPlan(make(Array.from({ length: 101 }, (_, i) => ({ rowId: String(i), currentBid: 1, suggestedBid: 2 })))), { code: "INVALID_BATCH" });
  for (const bid of [NaN, Infinity, 0, -1, 100.01, "1"]) assert.throws(() => validateBidPlan(make([{ rowId: "row", currentBid: 1, suggestedBid: bid }])), { code: "INVALID_BID" });
  assert.throws(() => validateBidPlan(make([input.report.bidRecommendations[0], input.report.bidRecommendations[0]])), { code: "INVALID_TARGET" });
  const unsupported = make([input.report.bidRecommendations[0]]); unsupported.operations[0].operationType = "add_negative_keyword";
  assert.throws(() => validateBidPlan(unsupported), { code: "UNSUPPORTED_OPERATION" });
  assert.equal(validateBidPlan(make([{ rowId: "row", currentBid: 1, suggestedBid: 2 }])).length, 1);
  assert.equal(actionDigest({ a: 1, b: 2 }), actionDigest({ b: 2, a: 1 }));
});
test("Ads stub has official SP v3 headers/body contracts and safe error mapping, no transport", () => {
  const common = { region: "NA" as const, profileId: "123", clientId: "test-client", accessToken: "test-token" };
  const keyword = sponsoredProductsBidRequest({ ...common, updates: [{ entity: "keyword", entityId: "456", bid: 0.5 }] });
  assert.equal(keyword.method, "PUT"); assert.equal(keyword.url, "https://advertising-api.amazon.com/sp/keywords");
  assert.equal(keyword.headers["Amazon-Advertising-API-Scope"], "123"); assert.equal(keyword.headers.Authorization, "Bearer test-token");
  assert.deepEqual(keyword.body, { keywords: [{ keywordId: "456", bid: 0.5 }] });
  const target = sponsoredProductsBidRequest({ ...common, region: "EU", updates: [{ entity: "target", entityId: "789", bid: 1 }] });
  assert.deepEqual(target.body, { targetingClauses: [{ targetId: "789", bid: 1 }] });
  assert.match(target.url, /advertising-api-eu/);
  assert.throws(() => sponsoredProductsBidRequest({ ...common, updates: [{ entity: "keyword", entityId: "local-row-id", bid: 1 }] }), { code: "INVALID_REQUEST" });
  for (const status of [400, 401, 403, 429, 500]) { const error = mapAmazonAdsError(status); assert.equal(error.retryable, false); assert.match(error.message, /reconcile/); }
  assert.throws(() => assertAmazonAdsTransportImplemented(), { code: "NOT_IMPLEMENTED" });
});

test("stub batch client fails before transport and v3 partial outcomes cannot become whole-batch success", async () => {
  const { unimplementedAmazonAdsBidClient, parseSponsoredProductsBidResponse } = await import("@/lib/amazon/ads-client");
  const updates = [{ entity: "keyword" as const, entityId: "123", bid: 1 }, { entity: "keyword" as const, entityId: "456", bid: 2 }];
  await assert.rejects(() => unimplementedAmazonAdsBidClient.updateBids({ region: "NA", profileId: "1", clientId: "test", accessToken: "test", updates }), { code: "NOT_IMPLEMENTED" });
  assert.deepEqual(parseSponsoredProductsBidResponse({ keywords: { success: [{ index: 0, keywordId: "123" }], error: [{ index: 1, errors: [{ errorType: "INVALID_ARGUMENT" }] }] } }, updates).map((row) => row.status), ["APPLIED", "FAILED"]);
  assert.throws(() => parseSponsoredProductsBidResponse({ keywords: { success: [{ index: 0, keywordId: "123" }], error: [] } }, updates), { code: "OUTCOME_UNKNOWN" });
  assert.throws(() => parseSponsoredProductsBidResponse({ keywords: { success: [{ index: 0, keywordId: "WRONG" }], error: [{ index: 1 }] } }, updates), { code: "OUTCOME_UNKNOWN" });
});
