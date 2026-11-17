import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import type { AmazonSyncRun } from "@prisma/client";
import { createReportProcessor } from "@/lib/amazon-sync/reports-processor";
import { encryptCheckpoint, decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import { seal } from "@/lib/amazon-sync/approval-policy";
import { resolveRequestedRange } from "@/lib/amazon-sync/date-range";
import { salesTrafficReportType } from "@/lib/amazon-sync/sales-traffic";

type Runtime = Parameters<typeof createReportProcessor>[0];
const marketplaceId = "ATVPDKIKX0DER";
const range = resolveRequestedRange(marketplaceId, { dateFrom: "2026-11-01", dateTo: "2026-11-01" }, new Date("2026-11-03T12:00:00Z"));

// 直接执行资源 factory，仅替换数据库与 transport，不读取 dotenv 或访问外部服务。
function fixture(resource = "sales_traffic", initial: Record<string, unknown> = {}) {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 74).toString("base64");
  const scope = { organizationId: "reports-fixture-org", workspaceId: "reports-fixture-workspace" };
  const run = { ...scope, id: "reports-fixture-run", sourceId: "reports-fixture-source", resource, trigger: "schedule", startedAt: new Date("2026-11-03"), frozenScope: { requestedRange: range }, checkpointCiphertext: encryptCheckpoint(JSON.stringify(initial), scope, "reports-fixture-run") } as unknown as AmazonSyncRun;
  const source = { id: run.sourceId, activeRunId: "old-head", coverage: { complete: true }, sellerAccountId: "fixture-store", marketplaceId, resource, authorization: { revision: 1 } };
  const writes: Array<{ kind: string; data: Record<string, unknown>; transaction: number }> = [], calls: string[] = [];
  let transaction = 0, denied = false, control = false, fenceLost = false, failRows = false, budget = false;
  let raw: Record<string, unknown> | null = null;
  const write = (kind: string, data: Record<string, unknown>) => { writes.push({ kind, data, transaction }); };
  const bulk = { createMany: async () => {}, updateMany: async () => {}, upsert: async () => {} };
  const tx = {
    amazonSyncApiBudget: { findUnique: async () => budget ? { nextRequestAt: new Date(Date.now() + 60000) } : null },
    amazonSyncRawPage: {
      findFirst: async () => raw, findFirstOrThrow: async () => raw, findUnique: async () => raw,
      create: async ({ data }: { data: Record<string, unknown> }) => { raw = data; write("raw", data); return raw; },
    },
    amazonSyncRun: { update: async ({ data }: { data: Record<string, unknown> }) => { write("run", data); Object.assign(run, data); return { ...run }; }, findFirst: async () => ({ startedAt: new Date("2026-11-04"), finishedAt: new Date("2026-11-04"), rawPages: [{ capturedAt: new Date("2026-11-04") }] }) },
    amazonSyncDataSource: { findFirst: async () => null, findFirstOrThrow: async () => source, update: async ({ data }: { data: Record<string, unknown> }) => write("source", data), updateMany: async ({ data }: { data: Record<string, unknown> }) => write("quality", data) },
    amazonSalesTrafficSnapshot: { createMany: async ({ data }: { data: unknown[] }) => { if (failRows) throw new Error("fixture 发布故障"); write("sales", { rows: data }); } },
    amazonCatalogSnapshot: { createMany: async ({ data }: { data: unknown[] }) => write("catalog", { rows: data }) },
    amazonSyncPage: { create: async ({ data }: { data: Record<string, unknown> }) => write("page", data) },
    amazonDataSourceRegistry: bulk, amazonFieldRegistry: bulk, amazonFieldObservation: bulk,
    amazonFieldMappingVersion: { ...bulk, findMany: async () => [] },
    auditLog: { findFirst: async () => null, create: async ({ data }: { data: Record<string, unknown> }) => write("audit", data) },
  };
  const runtime: Runtime = {
    prisma: { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => {
      transaction++; const start = writes.length, previousRaw = raw, previousRun = { ...run };
      try { return await fn(tx); } catch (error) { writes.splice(start); raw = previousRaw; Object.assign(run, previousRun); throw error; }
    } } as unknown as Runtime["prisma"],
    leaseMs: 300000, scopeLock: async () => { calls.push("lock"); }, assertActor: async () => { calls.push("actor"); },
    assertFence: async () => { calls.push("fence"); if (fenceLost) throw new Error("fixture fence lost"); return run; },
    assertLiveSource: async () => { calls.push("access"); if (denied) throw new Error("fixture 撤权"); return source as unknown as Awaited<ReturnType<Runtime["assertLiveSource"]>>; },
    stopForControl: async () => { if (fenceLost) throw new Error("fixture fence lost"); return control; },
    yieldSlice: async () => { calls.push("yield"); }, log: async () => {}, persistRequests: async () => { calls.push("record"); },
  };
  const client = {
    createSalesTrafficReport: async () => { calls.push("http:create"); return { reportId: "fixture-report" }; },
    createAllListingsReport: async () => { calls.push("http:create-listings"); return { reportId: "fixture-report" }; },
    getReports: async () => { calls.push("http:reconcile"); return { reports: [] }; },
    getReportDocument: async () => { calls.push("http:document"); return { reportDocumentId: "fixture-document" }; },
    downloadReportJsonText: async () => { calls.push("http:download"); return "{"; },
  };
  const state = () => JSON.parse(decryptCheckpoint(run.checkpointCiphertext, scope, run.id) ?? "{}");
  const archive = (text: string) => { raw = { ...scope, taskId: run.id, page: 1, resource, capturedAt: new Date("2026-11-03"), bodySha256: createHash("sha256").update(text).digest("hex"), rawCiphertext: seal({ rawText: text }, scope, `${run.id}:1`, resource === "catalog" ? "amazon-catalog-report-raw.v1" : "amazon-sales-traffic-raw.v1"), requestMetadata: { reportId: "fixture-report", documentId: "fixture-document", marketplaceId } }; };
  const report = (complete = true) => JSON.stringify({ reportSpecification: { reportType: salesTrafficReportType, reportOptions: { dateGranularity: "DAY", asinGranularity: "CHILD" }, marketplaceIds: [marketplaceId], dataStartTime: range.from, dataEndTime: range.to }, salesAndTrafficByDate: complete ? [{ date: range.from, salesByDate: { unitsOrdered: 1, totalOrderItems: 1, orderedProductSales: { amount: 2, currencyCode: "USD" } }, trafficByDate: { sessions: 3, pageViews: 4 } }] : [] });
  return { run, source, calls, writes, client, state, archive, report, raw: () => raw,
    execute: () => createReportProcessor(runtime)(run, client as unknown as Parameters<ReturnType<typeof createReportProcessor>>[1], [], "fixture-auth", marketplaceId, "fixture-store"),
    deny: () => { denied = true; }, pause: () => { control = true; }, loseFence: () => { fenceLost = true; }, budget: () => { budget = true; }, failRows: () => { failRows = true; },
  };
}
const downloaded = { reportId: "fixture-report", documentId: "fixture-document" };

test("报告创建先持久化意图并复用实时护栏", async () => {
  const f = fixture(); f.client.createSalesTrafficReport = async () => { assert.equal(f.state().creating, true); f.calls.push("http:create"); return { reportId: "fixture-report" }; };
  await f.execute(); assert.equal(f.state().reportId, "fixture-report"); assert.equal(f.state().creating, false);
  assert.ok(f.calls.filter(c => c === "access").length >= 3); assert.equal(f.run.stage, "REPORT_POLLING");
});

test("创建结果未知时只核对原报告，不重复创建", async () => {
  const f = fixture(); f.client.createSalesTrafficReport = async () => { f.calls.push("http:create"); throw new Error("fixture 响应丢失"); };
  await f.execute(); assert.equal(f.state().creating, true); await f.execute();
  assert.equal(f.calls.filter(c => c === "http:create").length, 1); assert.equal(f.calls.filter(c => c === "http:reconcile").length, 1);
});

test("撤权、暂停和 fence 丢失均在 HTTP 前阻断", async () => {
  for (const mode of ["deny", "pause", "loseFence"] as const) {
    const f = fixture(); f[mode]();
    if (mode === "pause") await f.execute(); else await assert.rejects(f.execute(), /撤权|fence lost/);
    assert.equal(f.writes.length, 0); assert.ok(!f.calls.some(c => c.startsWith("http:")));
  }
});

test("共享预算等待不创建报告", async () => {
  const f = fixture(); f.budget(); await f.execute(); assert.ok(f.calls.includes("yield")); assert.equal(f.writes.length, 0); assert.ok(!f.calls.some(c => c.startsWith("http:")));
});

test("下载原文先独立加密归档，JSON 拒绝仍保留证据", async () => {
  const f = fixture("sales_traffic", downloaded); await assert.rejects(f.execute(), /JSON 无效/);
  assert.ok(f.raw()); assert.equal(f.run.stage, "REPORT_PARSING"); assert.ok(!f.writes.some(w => w.kind === "sales" || w.kind === "source"));
});

test("归档重放绕过已耗尽预算且零 HTTP，旧原件不倒退发布头", async () => {
  const f = fixture("sales_traffic", downloaded); f.archive(f.report()); f.budget(); await f.execute();
  assert.equal(f.run.status, "SUCCEEDED"); assert.ok(!f.calls.some(c => c.startsWith("http:"))); assert.ok(!f.writes.some(w => w.kind === "source"));
  const rows = f.writes.find(w => w.kind === "sales")!; const terminal = f.writes.find(w => w.kind === "run" && w.data.status === "SUCCEEDED")!;
  assert.equal(rows.transaction, terminal.transaction); assert.equal(((rows.data.rows as Array<{ capturedAt: Date }>)[0]).capturedAt.toISOString(), "2026-11-03T00:00:00.000Z");
});

test("不完整销售报告保存质量与原检查点但不替换完整发布", async () => {
  const f = fixture("sales_traffic", downloaded); f.archive(f.report(false)); await f.execute();
  assert.equal(f.run.status, "PARTIAL_SUCCESS"); assert.equal(f.state().reportId, downloaded.reportId); assert.ok(f.writes.some(w => w.kind === "quality")); assert.ok(!f.writes.some(w => w.kind === "source"));
});

test("结构化事务失败不泄露发布，先前原件继续保留", async () => {
  const f = fixture("sales_traffic", downloaded); f.archive(f.report()); f.failRows(); await assert.rejects(f.execute(), /发布故障/);
  assert.ok(f.raw()); assert.ok(!f.writes.some(w => w.kind === "sales" || w.kind === "source")); assert.equal(f.run.stage, "REPORT_PARSING");
});

test("原件站点或摘要不匹配拒绝重放且零 HTTP", async () => {
  for (const mismatch of ["bodySha256", "requestMetadata"] as const) {
    const f = fixture("sales_traffic", downloaded); f.archive(f.report()); f.raw()![mismatch] = mismatch === "bodySha256" ? "0".repeat(64) : { ...downloaded, marketplaceId: "other-site" };
    await assert.rejects(f.execute(), /身份|摘要/); assert.equal(f.writes.length, 0); assert.ok(!f.calls.some(c => c.startsWith("http:")));
  }
});

test("完整销售报告的业务行与发布头在同一事务提交", async () => {
  const f = fixture("sales_traffic", downloaded); f.source.activeRunId = f.run.id; f.archive(f.report()); await f.execute();
  const rows = f.writes.find(w => w.kind === "sales")!, publication = f.writes.find(w => w.kind === "source")!;
  assert.ok(publication); assert.equal(rows.transaction, publication.transaction); assert.equal(f.run.status, "SUCCEEDED");
});

test("All Listings 原件重放将页、商品快照、发布头与终态原子提交", async () => {
  const f = fixture("catalog", downloaded); f.archive("seller-sku\tasin1\tstatus\nSKU-1\tB012345678\tActive\n"); await f.execute();
  const business = f.writes.filter(w => ["page", "catalog", "source"].includes(w.kind));
  assert.equal(business.length, 3); assert.equal(new Set(business.map(w => w.transaction)).size, 1);
  assert.equal(f.run.status, "SUCCEEDED"); assert.ok(!f.calls.some(c => c.startsWith("http:")));
});

test("All Listings 报告沿同一 factory 创建但不走销售接口", async () => {
  const f = fixture("catalog"); await f.execute(); assert.ok(f.calls.includes("http:create-listings")); assert.ok(!f.calls.includes("http:create"));
});
