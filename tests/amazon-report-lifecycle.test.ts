import assert from "node:assert/strict";
import test from "node:test";
import type { AmazonSyncRun } from "@prisma/client";
import { executeReportSlice } from "@/lib/amazon-sync/processor";
import { digest } from "@/lib/amazon-sync/approval-policy";
import { resolveRequestedRange } from "@/lib/amazon-sync/date-range";
import { decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { AmazonSpApiClient, type AmazonRequestEvent } from "@/lib/amazon/sp-api-client";
import { getAmazonSpApiServerConfiguration } from "@/lib/amazon/sp-api-config";

// Hermetic service tests: in-memory transaction double + mock HTTP. No DB, Redis or migrations.
const site = "ATVPDKIKX0DER", scope = { organizationId: "fixture-org", workspaceId: "fixture-ws" };
async function fixture(work: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const global = globalThis as { prisma?: unknown }, prior = global.prisma;
  const env = { key: process.env.AMAZON_SP_API_ENCRYPTION_KEY, db: process.env.DATABASE_URL, scopes: process.env.AMAZON_SYNC_CENTER_SCOPES, environment: process.env.AMAZON_DATA_CENTER_ENVIRONMENT };
  delete process.env.DATABASE_URL; process.env.AMAZON_DATA_CENTER_ENVIRONMENT = "local";
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64");
  process.env.AMAZON_SYNC_CENTER_SCOPES = JSON.stringify([[scope.organizationId, scope.workspaceId]]);
  try { const f = await setup(); global.prisma = f.db; await work(f); }
  finally { global.prisma = prior; for (const [key, value] of [["DATABASE_URL", env.db], ["AMAZON_SP_API_ENCRYPTION_KEY", env.key], ["AMAZON_SYNC_CENTER_SCOPES", env.scopes], ["AMAZON_DATA_CENTER_ENVIRONMENT", env.environment]]) { if (value === undefined) delete process.env[key!]; else process.env[key!] = value; } }
}
async function setup() {
  const range = resolveRequestedRange(site, { dateFrom: "2026-11-01", dateTo: "2026-11-02" }, new Date("2026-11-04T12:00:00Z"));
  const frozen = { executionExpiresAt: new Date(Date.now() + 3600000).toISOString(), sourceId: "source", sourceRevision: 1, authorizationId: "auth", authorizationRevision: 1, amazonSellerId: "fixture-seller", sellerAccountId: "store", marketplaceId: site, resource: "sales_traffic", requestedRange: range };
  const source = { id: "source", ...scope, enabled: true, revision: 1, authorizationId: "auth", sellerAccountId: "store", marketplaceId: site, resource: "sales_traffic", activeRunId: "old-good", authorization: { id: "auth", revision: 1, status: "CONFIGURED", amazonSellerId: "fixture-seller" }, seller: { status: "active" } };
  const state = { run: { id: "task", ...scope, resource: "sales_traffic", sourceId: "source", status: "RUNNING", control: null, stage: "WAITING", fenceVersion: 1, leaseOwner: "worker", leaseExpiresAt: new Date(Date.now() + 300000), attempts: 1, authorizationRevision: 1, executionApprovalId: "approval", requestedByUserId: "actor", executionStartedAt: new Date(), checkpointCiphertext: null, frozenScope: frozen, frozenScopeDigest: digest(frozen), dispatchVersion: 0, summary: null } as unknown as AmazonSyncRun,
    rows: [] as unknown[], logs: [] as unknown[], grant: true, actorActive: true, approverActive: true, conflict: false, partial: false, uncertain: false, source, apiCalls: [] as string[], dbCalls: [] as string[] };
  const db = {
    $executeRaw: async () => 0,
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    organizationMember: { findUnique: async (args: { where: { organizationId_userId: { userId: string } } }) => ({ role: "owner", user: { status: (args.where.organizationId_userId.userId === "approver" ? state.approverActive : state.actorActive) ? "active" : "disabled" } }) },
    organizationRosterRole: { findMany: async () => [] },
    amazonDataCenterChangeRequest: { findFirst: async (args: { where: Record<string, unknown> }) => { assert.equal(args.where.organizationId, scope.organizationId); assert.equal(args.where.workspaceId, scope.workspaceId); return state.grant ? { id: "approval", operation: "run", approvedByUserId: "approver" } : null; } },
    amazonSyncDataSource: {
      findFirst: async () => state.conflict ? { ...source, revision: 99 } : source,
      update: async (args: { data: object }) => { state.dbCalls.push("publish"); Object.assign(source, args.data); return source; },
    },
    amazonSyncApiBudget: { findUnique: async () => null, upsert: async () => ({}) },
    amazonSyncTaskLog: { create: async (args: { data: unknown }) => { state.logs.push(args.data); }, createMany: async (args: { data: unknown[] }) => { state.logs.push(...args.data); } },
    amazonSyncRun: {
      findFirst: async (args: { where: { status: string; fenceVersion: number } }) => state.run.status === args.where.status && state.run.fenceVersion === args.where.fenceVersion ? structuredClone(state.run) : null,
      update: async (args: { data: Record<string, unknown> }) => { for (const [key, value] of Object.entries(args.data)) { const current = state.run as unknown as Record<string, unknown>; if (value && typeof value === "object" && "increment" in value) current[key] = Number(current[key] ?? 0) + Number(value.increment); else current[key] = value; } return structuredClone(state.run); },
    },
    amazonSalesTrafficSnapshot: { createMany: async (args: { data: Array<{ organizationId: string; workspaceId: string; syncRunId: string }> }) => { assert.ok(args.data.every(row => row.organizationId === scope.organizationId && row.workspaceId === scope.workspaceId && row.syncRunId === "task")); state.rows.push(...args.data); return { count: args.data.length }; } },
    productRecord: new Proxy({}, { get() { throw new Error("Amazon sync must never write ProductRecord"); } }),
    $transaction: async <T>(work: (tx: unknown) => Promise<T>): Promise<T> => { const before = structuredClone({ run: state.run, rows: state.rows, source }); try { return await work(db); } catch (error) { state.run = before.run; state.rows = before.rows; Object.assign(source, before.source); throw error; } },
  };
  const events: AmazonRequestEvent[] = [];
  const client = new AmazonSpApiClient(getAmazonSpApiServerConfiguration({ AMAZON_SP_API_LWA_CLIENT_ID: "fixture-client", AMAZON_SP_API_LWA_CLIENT_SECRET: "fixture-secret", AMAZON_SP_API_REFRESH_TOKEN: "fixture-refresh" }), { onResponse: e => events.push(e), fetch: async (input, init) => {
    const url = new URL(String(input)); state.apiCalls.push(`${init?.method} ${url.pathname}`);
    if (url.hostname === "api.amazon.com") return Response.json({ access_token: "fixture-access", expires_in: 3600 });
    if (url.pathname === "/reports/2021-06-30/reports") { assert.equal(JSON.parse(init!.body as string).dataStartTime, range.startAt); if (state.uncertain) throw new Error("private-signed-url"); return Response.json({ reportId: "report" }); }
    if (url.pathname === "/reports/2021-06-30/reports/report") return Response.json({ reportId: "report", reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [site], processingStatus: "DONE", reportDocumentId: "document" });
    if (url.pathname === "/reports/2021-06-30/documents/document") return Response.json({ reportDocumentId: "document", url: "https://fixture.s3.us-east-1.amazonaws.com/report" });
    assert.equal(url.hostname, "fixture.s3.us-east-1.amazonaws.com");
    return Response.json({ reportSpecification: { reportType: "GET_SALES_AND_TRAFFIC_REPORT", marketplaceIds: [site], reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" }, dataStartTime: range.startAt, dataEndTime: range.reportEndAt }, salesAndTrafficByDate: (state.partial ? [range.from] : [range.from, range.to]).map(date => ({ date, salesByDate: { unitsOrdered: 2, totalOrderItems: 1, orderedProductSales: { amount: 20, currencyCode: "USD" } }, trafficByDate: { sessions: 10, pageViews: 15 } })) });
  } });
  const slice = async () => { state.run.status = "RUNNING"; state.run.leaseExpiresAt = new Date(Date.now() + 300000); events.length = 0; await executeReportSlice(structuredClone(state.run), client, events, "auth", site, "store"); };
  return { db, state, slice };
}

test("report service durably resumes create/poll/download and publishes traceable rows once", async () => fixture(async ({ state, slice }) => {
  await slice(); assert.equal(state.run.status, "WAITING"); assert.equal(state.source.activeRunId, "old-good"); assert.equal(state.rows.length, 0);
  const checkpoint = JSON.parse(decryptCheckpoint(state.run.checkpointCiphertext, scope, "task")!); assert.equal(checkpoint.reportId, "report"); assert.ok(!state.run.checkpointCiphertext!.includes("report"));
  await slice(); assert.equal(state.run.stage, "REPORT_DOWNLOADING"); await slice();
  assert.equal(state.run.status, "SUCCEEDED"); assert.equal(state.source.activeRunId, "task"); assert.equal(state.rows.length, 2); assert.equal(state.dbCalls.filter(v => v === "publish").length, 1);
  assert.equal(state.apiCalls.filter(v => v === "POST /reports/2021-06-30/reports").length, 1);
  const row = state.rows[0] as { reportId: string; documentId: string; businessDate: string }; assert.equal(row.reportId, "report"); assert.equal(row.documentId, "document"); assert.equal(row.businessDate, "2026-11-01");
}));
test("partial report retains quality evidence and never replaces the previous valid version", async () => fixture(async ({ state, slice }) => {
  state.partial = true; await slice(); await slice(); await slice();
  assert.equal(state.run.status, "PARTIAL_SUCCESS"); assert.equal(state.source.activeRunId, "old-good"); assert.equal(state.rows.length, 1); assert.equal(state.dbCalls.length, 0);
}));
test("revoked grant, changed source and revoked actor/approver all stop before any HTTP", async () => {
  for (const mode of ["grant", "conflict", "actorActive", "approverActive"] as const) await fixture(async ({ state, slice }) => {
    if (mode === "conflict") state.conflict = true; else state[mode] = false;
    await assert.rejects(slice); assert.equal(state.apiCalls.length, 0); assert.equal(state.source.activeRunId, "old-good");
  });
});
test("an uncertain create is persisted and never automatically replayed", async () => fixture(async ({ state, slice }) => {
  state.uncertain = true; await assert.rejects(slice, /不确定/); const count = state.apiCalls.length;
  state.uncertain = false; await assert.rejects(slice, /不确定/); assert.equal(state.apiCalls.length, count); assert.equal(state.source.activeRunId, "old-good");
}));
