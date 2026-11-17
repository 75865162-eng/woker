import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { AmazonSyncRun } from "@prisma/client";
import { createReturnProcessor } from "@/lib/amazon-sync/returns-processor";
import { parseReturnPolicy, parseReturnState } from "@/lib/amazon-sync/returns";
import { digest, seal } from "@/lib/amazon-sync/approval-policy";
import { encryptCheckpoint, decryptCheckpoint } from "@/lib/amazon-sync/checkpoint";

const policy = parseReturnPolicy(JSON.parse(readFileSync(new URL("./fixtures/amazon/returns/policy.json", import.meta.url), "utf8")));
const window = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-02T00:00:00.000Z" };
const now = () => new Date("2026-11-03T00:00:00Z");
type Runtime = Parameters<typeof createReturnProcessor>[0];

// 只注入内存事务和 transport；不初始化真实 Prisma，不加载 dotenv。
function fixture(initial = { polls: 0, offset: 0 } as Record<string, unknown>) {
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString("base64");
  const scope = { organizationId: "returns-fixture-org", workspaceId: "returns-fixture-workspace" };
  const run = { ...scope, id: "returns-fixture-run", sourceId: "returns-fixture-source", resource: "returns", trigger: "manual", frozenScope: { returnWindow: window }, summary: {}, attempts: 1 } as unknown as AmazonSyncRun;
  const source = { ...scope, id: run.sourceId, marketplaceId: "fixture-marketplace", sellerAccountId: "fixture-store", returnsPolicy: policy, authorization: { id: "fixture-auth", amazonSellerId: "fixture-seller" } };
  const cursor = { ...scope, id: "fixture-cursor", sourceId: source.id, resource: "returns", amazonSellerId: "fixture-seller", marketplaceId: source.marketplaceId, activeRunId: run.id, status: "RUNNING", watermarkFrom: new Date(window.from), watermarkTo: new Date(window.to), detailPolicyDigest: digest(policy), reportStateCiphertext: encryptCheckpoint(JSON.stringify(initial), scope, "fixture-cursor") };
  const calls: string[] = [], writes: Array<{ kind: string; data: Record<string, unknown>; transaction: number }> = [];
  let transaction = 0, control = false, denied = false, budgetAt: Date | null = null, records = 0;
  let raw: Record<string, unknown> | null = null;
  const tx = {
    $executeRaw: async () => {},
    amazonSyncResourceCursor: {
      findUnique: async () => ({ ...cursor }), findUniqueOrThrow: async () => ({ ...cursor }),
      upsert: async ({ update }: { update: Record<string, unknown> }) => { Object.assign(cursor, update); return { ...cursor }; },
      update: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "cursor", data, transaction }); Object.assign(cursor, data); return { ...cursor }; },
    },
    amazonSyncRun: { update: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "run", data, transaction }); return { ...run, ...data }; } },
    amazonSyncApiBudget: { findUnique: async () => budgetAt ? { nextRequestAt: budgetAt } : null, upsert: async () => {} },
    amazonSyncTokenBucket: { findUnique: async () => null, upsert: async () => {} },
    amazonSyncRawPage: { findFirst: async () => raw },
    amazonReturnReason: { upsert: async () => {} },
    amazonReturnRecord: { createMany: async () => { records++; writes.push({ kind: "row", data: {}, transaction }); return { count: 1 }; }, count: async () => records },
    auditLog: { create: async () => {} },
    amazonSyncDataSource: { update: async ({ data }: { data: Record<string, unknown> }) => { writes.push({ kind: "source", data, transaction }); }, findFirst: async () => null },
  };
  const prisma = { ...tx, $transaction: async (fn: (client: typeof tx) => unknown) => { transaction++; return fn(tx); } } as unknown as Runtime["prisma"];
  const runtime: Runtime = {
    prisma, leaseMs: 300000,
    scopeLock: async () => { calls.push("lock"); },
    assertFence: async () => { calls.push("fence"); return run; },
    assertLiveSource: async () => { calls.push("access"); if (denied) throw new Error("fixture 撤权"); return source as unknown as Awaited<ReturnType<Runtime["assertLiveSource"]>>; },
    stopForControl: async () => control,
    yieldSlice: async () => { calls.push("yield"); },
    log: async () => {}, persistOrderRequests: async () => { calls.push("record"); }, fenceLost: () => new Error("fixture fence lost"),
  };
  const client = { createReport: async () => { calls.push("http:create"); return { reportId: "fixture-report" }; }, getReport: async () => { calls.push("http:poll"); return { reportId: "fixture-report", reportType: policy.reportType, marketplaceIds: [source.marketplaceId], dataStartTime: window.from, dataEndTime: window.to, processingStatus: "IN_PROGRESS" }; } };
  const execute = () => createReturnProcessor(runtime)(run, client as unknown as Parameters<ReturnType<typeof createReturnProcessor>>[1], [], now);
  return { run, cursor, calls, writes, client, execute,
    state: () => parseReturnState(decryptCheckpoint(cursor.reportStateCiphertext, scope, cursor.id)),
    deny: () => { denied = true; }, control: () => { control = true; }, budget: () => { budgetAt = new Date(now().getTime() + 60000); },
    archive: () => { const rawText = readFileSync(new URL("./fixtures/amazon/returns/report.tsv", import.meta.url), "utf8"); raw = { taskId: run.id, page: 1, bodySha256: createHash("sha256").update(rawText).digest("hex"), rawCiphertext: seal({ rawText }, scope, `${run.id}:1`, "amazon-returns-raw.v1"), capturedAt: now(), requestMetadata: {} }; },
  };
}

test("退货资源创建前先写不确定意图并逐事务复用实时护栏", async () => {
  const f = fixture();
  f.client.createReport = async () => { assert.equal(f.state().creating, true); f.calls.push("http:create"); return { reportId: "fixture-report" }; };
  await f.execute();
  assert.equal(f.state().reportId, "fixture-report"); assert.equal(f.state().creating, false);
  assert.equal(f.writes.at(-1)?.data.stage, "RETURN_REPORT_POLLING");
  assert.ok(f.calls.filter(c => c === "access").length >= 5);
  assert.deepEqual(f.calls.slice(0, 3), ["lock", "fence", "access"]);
});

test("创建结果未知时保留 creating；下一片不得重放 HTTP", async () => {
  const f = fixture();
  f.client.createReport = async () => { f.calls.push("http:create"); throw new Error("fixture transport"); };
  await assert.rejects(f.execute(), /创建结果不确定/);
  assert.equal(f.state().creating, true);
  await assert.rejects(f.execute(), /禁止自动重复创建/);
  assert.equal(f.calls.filter(c => c === "http:create").length, 1);
});

test("实时撤权在任何退货 HTTP 和状态写入前阻断", async () => {
  const f = fixture(); f.deny();
  await assert.rejects(f.execute(), /撤权/);
  assert.equal(f.writes.length, 0); assert.ok(!f.calls.some(c => c.startsWith("http:")));
});

test("共享 Reports 预算等待不消费 HTTP", async () => {
  const f = fixture(); f.budget(); await f.execute();
  assert.ok(f.calls.includes("yield")); assert.ok(!f.calls.some(c => c.startsWith("http:")));
});

test("现有报告轮询保留 ID 与有界次数", async () => {
  const f = fixture({ polls: 0, offset: 0, reportId: "fixture-report" }); await f.execute();
  assert.equal(f.state().reportId, "fixture-report"); assert.equal(f.state().polls, 1);
  assert.equal(f.writes.at(-1)?.data.stage, "RETURN_REPORT_POLLING");
  assert.equal(f.calls.filter(c => c === "http:poll").length, 1);
});

test("不完整批次的业务行与 offset 检查点在同一事务提交", async () => {
  const f = fixture({ polls: 1, offset: 0, reportId: "fixture-report", archiveTaskId: "returns-fixture-run" }); f.archive();
  await f.execute();
  assert.equal(f.state().offset, 1);
  const row = f.writes.find(w => w.kind === "row"), checkpoint = f.writes.find(w => w.kind === "cursor");
  assert.ok(row); assert.ok(checkpoint); assert.equal(row.transaction, checkpoint.transaction);
  assert.equal(f.writes.at(-1)?.data.stage, "RETURN_BATCH_COMMITTED");
  assert.ok(!f.writes.some(w => w.kind === "source")); assert.ok(!f.calls.some(c => c.startsWith("http:")));
});

test("报告末批才原子发布资源覆盖并完成游标", async () => {
  const f = fixture({ polls: 1, offset: 2, reportId: "fixture-report", archiveTaskId: "returns-fixture-run" }); f.archive();
  await f.execute();
  assert.equal(f.state().offset, 3); assert.equal(f.cursor.status, "SUCCEEDED");
  const publication = f.writes.find(w => w.kind === "source"), checkpoint = f.writes.find(w => w.kind === "cursor");
  assert.ok(publication); assert.ok(checkpoint); assert.equal(publication.transaction, checkpoint.transaction);
  assert.equal(f.writes.at(-1)?.data.status, "SUCCEEDED");
  assert.equal((publication.data.coverage as { returnsUniverseComplete: boolean }).returnsUniverseComplete, false);
});

test("手动任务不能使用自动历史回放旁路", async () => {
  const f = fixture(); f.run.frozenScope = { returnWindow: window, returnHistoryReplay: true };
  await assert.rejects(f.execute(), /只能由自动计划执行/);
  assert.equal(f.writes.length, 0); assert.ok(!f.calls.some(c => c.startsWith("http:")));
});

test("暂停控制阻止归档批次与检查点写入", async () => {
  const f = fixture({ polls: 1, offset: 0, reportId: "fixture-report", archiveTaskId: "returns-fixture-run" }); f.archive(); f.control();
  await f.execute(); assert.equal(f.writes.length, 0); assert.equal(f.state().offset, 0);
});

test("跨租户游标在 HTTP 前拒绝", async () => {
  const f = fixture(); f.cursor.organizationId = "fixture-other-org";
  await assert.rejects(f.execute(), /游标身份不匹配/);
  assert.ok(!f.calls.some(c => c.startsWith("http:")));
});
