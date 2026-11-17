import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { AmazonSyncRun } from "@prisma/client";
import { createDomainReportProcessor } from "@/lib/amazon-sync/domain-reports-processor";
import { createObservationProcessor } from "@/lib/amazon-sync/observation-processor";
import { createOrderProcessor } from "@/lib/amazon-sync/orders-processor";
import { createOrderDetailProcessor } from "@/lib/amazon-sync/order-detail-processor";
import { queueOrderBackfill } from "@/lib/amazon-sync/order-gaps";
import type { SyncProcessorRuntime } from "@/lib/amazon-sync/processor-runtime";
import { encryptCheckpoint, decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { seal, digest } from "@/lib/amazon-sync/approval-policy";

function fixture(resource = "inventory_age", initial: Record<string, unknown> = {}) {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 81).toString("base64");
  const scope = { organizationId: "resource-fixture-org", workspaceId: "resource-fixture-workspace" };
  const run = { ...scope, id: "resource-fixture-run", sourceId: "resource-fixture-source", resource, trigger: "schedule", pagesCompleted: 0, processedCount: 0, insertedCount: 0, skippedCount: 0, detailsCompletedCount: 0, frozenScope: {}, executionStartedAt: new Date(), startedAt: new Date(), checkpointCiphertext: null } as unknown as AmazonSyncRun;
  const source = { id: run.sourceId, ...scope, sellerAccountId: "fixture-store", marketplaceId: "ATVPDKIKX0DER", activeRunId: "previous-head", authorizationId: "fixture-auth", revision: 1, authorization: { id: "fixture-auth", revision: 1, amazonSellerId: "fixture-seller", awsRegion: "us-east-1", endpoint: "https://sellingpartnerapi-na.amazon.com", approvedRoles: [], rolesAttestedAt: null, marketplaceParticipations: [{ marketplace: { id: "ATVPDKIKX0DER" }, participation: { isParticipating: true } }] }, orderPolicy: { initialFrom: "2026-11-01T00:00:00.000Z", windowMinutes: 60, overlapSeconds: 120, safetyLagSeconds: 120, marketplaceTimeZone: "Etc/UTC", applicationId: "fixture-app", requestsPerSecond: .0056, burst: 20, statusMapping: {}, requiredRoles: [] }, domainPolicy: null };
  const cursor = { id: "fixture-cursor", ...scope, sourceId: source.id, resource, amazonSellerId: source.authorization.amazonSellerId, marketplaceId: source.marketplaceId, activeRunId: run.id, status: "RUNNING", watermarkFrom: new Date("2026-11-01"), watermarkTo: new Date("2026-11-02"), reportStateCiphertext: encryptCheckpoint(JSON.stringify(initial), scope, "fixture-cursor"), nextTokenCiphertext: null, listComplete: false, detailPolicyDigest: null };
  const calls: string[] = [], writes: Array<{ kind: string; data: Record<string, unknown>; transaction: number }> = [];
  let transaction = 0, denied = false, stopped = false, fence = false, budget = false, failRun = false, raw: Record<string, unknown> | null = null;
  const write = (kind: string, data: Record<string, unknown>) => writes.push({ kind, data, transaction });
  const tx = {
    amazonSyncResourceCursor: { findUnique: async () => cursor, findUniqueOrThrow: async () => cursor, upsert: async () => cursor, update: async ({ data }: { data: Record<string, unknown> }) => { write("cursor", data); Object.assign(cursor, data); return cursor; } },
    amazonSyncApiBudget: { findUnique: async () => budget ? { nextRequestAt: new Date(Date.now() + 60000) } : null, upsert: async () => {} },
    amazonSyncTokenBucket: { findUnique: async () => null, upsert: async () => {}, update: async () => {} },
    amazonSyncRun: { findFirst: async () => null, update: async ({ data }: { data: Record<string, unknown> }) => { if (failRun && data.status === "SUCCEEDED") throw new Error("fixture 发布故障"); write("run", data); for (const [key, value] of Object.entries(data)) (run as unknown as Record<string, unknown>)[key] = value && typeof value === "object" && "increment" in value ? Number((run as unknown as Record<string, unknown>)[key] ?? 0) + Number(value.increment) : value; return run; } },
    amazonSyncRawPage: { findFirst: async () => raw, findUnique: async () => raw, create: async ({ data }: { data: Record<string, unknown> }) => { raw = data; write("raw", data); } },
    amazonSyncDataSource: { findFirst: async () => source, findMany: async () => [], update: async ({ data }: { data: Record<string, unknown> }) => { write("source", data); Object.assign(source, data); } },
    amazonSyncPage: { findUnique: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => write("page", data) },
    amazonDomainObservation: { count: async () => run.insertedCount, findMany: async () => [], createMany: async ({ data }: { data: unknown[] }) => { write("facts", { rows: data }); return { count: data.length }; } },
    amazonOrderRecord: { count: async () => 0 },
    amazonDataSourceRegistry: { upsert: async () => {}, updateMany: async () => {} }, amazonFieldRegistry: { createMany: async () => {}, updateMany: async () => {}, upsert: async () => {} }, amazonFieldObservation: { createMany: async () => {} }, amazonFieldMappingVersion: { findMany: async () => [] },
    auditLog: { findFirst: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => write("audit", data) },
    $executeRaw: async () => 0,
  };
  const runtime = { prisma: { ...tx, $transaction: async (fn: (t: typeof tx) => unknown) => { transaction++; const start = writes.length, oldRun = { ...run }, oldCursor = { ...cursor }, oldSource = { ...source }, oldRaw = raw; try { return await fn(tx); } catch (e) { writes.splice(start); Object.assign(run, oldRun); Object.assign(cursor, oldCursor); Object.assign(source, oldSource); raw = oldRaw; throw e; } } }, leaseMs: 300000, maxPages: 1000, maxRows: 50000, scopeLock: async () => {}, assertActor: async () => {}, assertFence: async () => { if (fence) throw new Error("fixture fence"); return run; }, assertLiveSource: async () => { if (denied) throw new Error("fixture 撤权"); return source; }, stopForControl: async () => stopped, yieldSlice: async () => { calls.push("yield"); }, log: async () => {}, persistRequests: async () => {}, persistOrderRequests: async () => {}, fenceLost: () => new Error("fixture fence"), preflightRejected: (message: string) => new Error(message) } as unknown as SyncProcessorRuntime;
  const client = { createSnapshotReport: async () => { calls.push("create"); return { reportId: "fixture-report" }; }, getReports: async () => { calls.push("reconcile"); return { reports: [] }; }, getReportDocument: async () => { calls.push("document"); return {}; }, downloadReportText: async () => { calls.push("download"); return "invalid"; }, getListingDetail: async () => { calls.push("listing"); return { rawBody: "{}", body: {} }; } };
  return { scope, run, source, cursor, calls, writes, runtime, client, tx, raw: () => raw, deny: () => { denied = true; }, pause: () => { stopped = true; }, fence: () => { fence = true; }, budget: () => { budget = true; }, failPublish: () => { failRun = true; }, archive: (text: string) => { raw = { ...scope, taskId: run.id, page: 1, resource, bodySha256: createHash("sha256").update(text).digest("hex"), rawCiphertext: seal({ rawText: text }, scope, `${run.id}:1`, `amazon-${resource}-raw.v1`) }; }, state: () => JSON.parse(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id) ?? "{}"), domain: () => createDomainReportProcessor(runtime)(run, client as unknown as Parameters<ReturnType<typeof createDomainReportProcessor>>[1], []), observation: () => createObservationProcessor(runtime)(run, client as unknown as Parameters<ReturnType<typeof createObservationProcessor>>[1], []) };
}

test("报告 factory 在创建前保存意图，未知结果只核对不重建", async () => {
  const f = fixture(); f.client.createSnapshotReport = async () => { assert.equal(f.state().creating, true); f.calls.push("create"); throw new Error("fixture 响应丢失"); };
  await assert.rejects(f.domain(), /响应丢失/); await f.domain(); assert.deepEqual(f.calls, ["create", "reconcile"]); assert.equal(f.state().creating, true);
});

test("报告控制、撤权、fence 与共享预算均阻止 HTTP", async () => {
  for (const mode of ["deny", "pause", "fence", "budget"] as const) {
    const f = fixture(); f[mode](); if (mode === "deny" || mode === "fence") await assert.rejects(f.domain(), /撤权|fence/); else await f.domain();
    assert.equal(f.calls.some(c => ["create", "download"].includes(c)), false);
  }
});

test("报告归档独立提交，重试在预算耗尽时重放原件且零 HTTP", async () => {
  const f = fixture("inventory_age", { reportId: "fixture-report", documentId: "fixture-document" });
  await f.domain(); assert.ok(f.raw()); assert.equal(f.state().archiveTaskId, f.run.id); f.calls.length = 0; f.budget();
  await assert.rejects(f.domain(), /报告格式/); assert.deepEqual(f.calls, []); assert.ok(f.raw()); assert.equal(f.source.activeRunId, "previous-head");
});

test("结算发现分页保存 token 并在同一发现窗口继续", async () => {
  const f = fixture("settlements"); const now = new Date(); f.cursor.watermarkFrom = new Date(now.getTime() - 86400000); f.cursor.watermarkTo = now; f.run.frozenScope = { reportWindow: { createdSince: f.cursor.watermarkFrom.toISOString(), createdUntil: now.toISOString() } };
  const requests: unknown[] = []; Object.assign(f.client, { getReports: async (input: unknown) => { requests.push(input); return requests.length === 1 ? { reports: [], nextToken: "fixture-next" } : { reports: [] }; } });
  await f.domain(); assert.equal(f.state().discoveryToken, "fixture-next"); await f.domain(); assert.equal((requests[1] as { nextToken: string }).nextToken, "fixture-next"); assert.equal(f.run.status, "SUCCEEDED");
});

test("结算终态事务失败回滚来源与游标，不丢发现检查点", async () => {
  const f = fixture("settlements", { discoveryToken: "fixture-next" }); const now = new Date(); f.cursor.watermarkFrom = new Date(now.getTime() - 86400000); f.cursor.watermarkTo = now; f.run.frozenScope = { reportWindow: { createdSince: f.cursor.watermarkFrom.toISOString(), createdUntil: now.toISOString() } }; f.failPublish();
  await assert.rejects(f.domain(), /发布故障/); assert.equal(f.source.activeRunId, "previous-head"); assert.equal(f.cursor.status, "RUNNING"); assert.equal(f.state().discoveryToken, "fixture-next"); assert.equal(f.writes.some(w => w.kind === "source"), false);
});

function observationFixture(state: Record<string, unknown> = {}) {
  const f = fixture("listing_details"); f.source.domainPolicy = { resource: "listing_details", applicationId: "fixture-app", maxRows: 100, maxRequests: 10, requestsPerSecond: .01, sellerSkus: ["fixture-sku"] } as never;
  f.run.checkpointCiphertext = seal({ state: { version: 1, stage: "PRODUCT_DETAIL", planIndex: 0, shipmentIndex: 0, shipmentIds: [], priorTokens: [], requests: 0, ...state } }, f.scope, f.run.id, "amazon-observation-state.v1"); return f;
}

test("观察 factory 控制、撤权、fence 与预算均在 HTTP 前阻断", async () => {
  for (const mode of ["deny", "pause", "fence", "budget"] as const) { const f = observationFixture(); f[mode](); if (mode === "deny" || mode === "fence") await assert.rejects(f.observation(), /撤权|fence/); else await f.observation(); assert.equal(f.calls.includes("listing"), false); }
});

test("观察请求预算耗尽拒绝采集，不发布来源", async () => {
  const f = observationFixture({ requests: 10 }); await assert.rejects(f.observation(), /请求预算/); assert.equal(f.calls.includes("listing"), false); assert.equal(f.writes.some(w => w.kind === "source"), false);
});

test("观察发布头和终态同事务提交，失败保留原发布头", async () => {
  for (const fail of [false, true]) {
    const f = observationFixture({ stage: "COMPLETE", requests: 1, planIndex: 1 });
    if (fail) { f.failPublish(); await assert.rejects(f.observation(), /发布故障/); assert.equal(f.source.activeRunId, "previous-head"); assert.equal(f.writes.some(w => w.kind === "source"), false); }
    else { await f.observation(); assert.equal(f.run.status, "SUCCEEDED"); const sourceWrite = f.writes.find(w => w.kind === "source")!; const finalWrite = f.writes.find(w => w.kind === "run" && w.data.status === "SUCCEEDED")!; assert.equal(sourceWrite.transaction, finalWrite.transaction); }
  }
});

test("订单 factory 拒绝非当前窗口恢复并保留检查点", async () => {
  const f = fixture("orders"); f.run.frozenScope = { orderWindow: { from: "2026-11-01T00:00:00.000Z", to: "2026-11-01T01:00:00.000Z" } };
  await assert.rejects(createOrderProcessor(f.runtime)(f.run, f.client as never, []), /窗口与未完成游标不匹配/); assert.equal(f.cursor.activeRunId, f.run.id); assert.equal(f.writes.length, 0);
});

test("订单详情控制、撤权与 fence 在明细请求前阻断", async () => {
  for (const mode of ["deny", "pause", "fence"] as const) {
    const f = fixture("orders"); f[mode]();
    const policy = { ...f.source.orderPolicy, details: { includedData: [], requiredRoles: [], requestsPerSecond: .2, burst: 1, maxOrders: 10, purpose: "fixture" } };
    const work = { id: "fixture-work", amazonOrderId: "fixture-order", listedUpdatedAt: new Date("2026-11-01") };
    const execute = () => createOrderDetailProcessor(f.runtime)(f.run, f.source as never, policy as never, { from: "2026-11-01T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" }, f.cursor as never, work as never, f.client as never, [], () => new Date());
    if (mode === "pause") await execute(); else await assert.rejects(execute(), /撤权|fence/);
    assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 0);
  }
});

test("订单缺口只使用当前窗口剩余预算并重开精确选中任务", async () => {
  const f = fixture("orders"); const details = { maxOrders: 3 }; const updated = new Date("2026-11-01"); let take = 0; let reopened: unknown;
  const tx = { amazonOrderDetailWork: { count: async () => 2, createMany: async () => {}, updateMany: async (input: unknown) => { reopened = input; } }, amazonOrderRecord: { fields: { sourceUpdatedAt: "fixture-field" }, findMany: async (input: { take: number }) => { take = input.take; return [{ id: "a", amazonOrderId: "a", sourceUpdatedAt: updated }, { id: "b", amazonOrderId: "b", sourceUpdatedAt: updated }]; } } };
  const result = await queueOrderBackfill(tx as never, f.run, f.source as never, { details } as never, { from: updated.toISOString(), to: "2026-11-02T00:00:00.000Z" });
  assert.equal(take, 2); assert.deepEqual(result, { enabled: true, selected: 1, deferred: true }); assert.deepEqual((reopened as { where: { id: { in: string[] } } }).where.id.in, [digest({ sourceId: f.source.id, amazonOrderId: "a", listedUpdatedAt: updated, policyDigest: digest(details) })]);
});
