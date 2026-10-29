import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { parseSellfoxAdsReparseArgs, reparseSellfoxAdsReportsFromCache, type SellfoxAdsReparseInput } from "@/lib/sellfox/ads-reparse-from-cache";
import type { SellfoxCpcReportType } from "@/lib/sellfox/ads-report-sync";

type Row = Record<string, unknown>;
const input = { organizationId: "org", workspaceId: "workspace" };
const store = { ...input, id: "store", externalId: "shop", name: "Fixture" };
function task(id: string, reportTypeCode: SellfoxCpcReportType = "adTargeringReport") {
  return { ...input, id, storeId: store.id, adType: "sp", reportTypeCode, startDate: "2026-10-24", endDate: "2026-10-24", status: "done",
    fileKey: `sellfox-reports/org/workspace/${id}.xlsx` as string | null, SellfoxStore: { ...store } };
}
function legacyRow(targetingId = "text:old") {
  return { ...input, id: "old", storeId: "store", adType: "sp", reportDate: "2026-10-24", campaignId: "campaign", adGroupId: "group", targetingId, searchTerm: "query" };
}
async function xlsx(code: SellfoxCpcReportType, options: { invalid?: boolean; empty?: boolean; rows?: number } = {}) {
  const raw = { 店铺: "Fixture", 日期: "2026-10-24", 广告活动ID: options.invalid ? "" : "campaign", 广告曝光量: 10, 广告点击量: 1, 广告花费: 1.5, 广告订单量: 1, 广告销售额: 10,
    ...(code === "adCampaignReport" ? {} : code === "adSpaceReport" ? { 广告位: "商品详情页" } : { 广告组ID: "group" }),
    ...(code === "adProductReport" ? { 广告产品ID: "product", asin: "ASIN", sku: "SKU" } : {}),
    ...(["adTargeringReport", "adSearchTermReport"].includes(code) ? { 广告投放ID: "120449591864118", 投放: "target", 匹配类型: "EXACT" } : {}),
    ...(code === "adSearchTermReport" ? { 用户搜索词: "query" } : {}) };
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("report");
  sheet.addRow(Object.keys(raw));
  if (!options.empty) for (let i = 0; i < (options.rows ?? 1); i++) sheet.addRow(Object.values({ ...raw, ...(i ? { 广告投放ID: `${120449591864118 + i}` } : {}) }));
  return Buffer.from(await book.xlsx.writeBuffer());
}

function fixture(tasks = [task("cached")]) {
  const windows: Record<string, Row[]> = { adTargeringReport: [legacyRow()], adSearchTermReport: [legacyRow("")] };
  const files = new Map<string, Buffer>();
  const reads: string[] = []; const mutations: string[] = []; const queries: Row[] = []; const batches: number[] = [];
  let transactions = 0, failInsert = false, returnForeign = false;
  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return (value as Row[]).some(part => matches(row, part));
      if (key === "SellfoxStore") return matches(row[key] as Row, value as Row);
      if (value && typeof value === "object") return Object.entries(value).every(([op, operand]) => {
        if (op === "in") return (operand as unknown[]).includes(row[key]);
        if (op === "not") return row[key] !== operand;
        if (op === "gte") return String(row[key]) >= String(operand);
        if (op === "lte") return String(row[key]) <= String(operand);
        if (op === "startsWith") return String(row[key]).startsWith(String(operand));
        throw Error(`Unsupported fixture operator ${op}`);
      });
      return row[key] === value;
    });
  }
  function checked(where: Row) {
    assert.equal(where.organizationId, "org"); assert.equal(where.workspaceId, "workspace"); queries.push(where);
  }
  const models = Object.fromEntries(Object.entries({ adProductReport: "sellfoxAdsProductDaily", adTargeringReport: "sellfoxAdsTargetingDaily", adSearchTermReport: "sellfoxAdsSearchTermDaily", adCampaignReport: "sellfoxAdsCampaignDaily", adGroupReport: "sellfoxAdsAdGroupDaily", adSpaceReport: "sellfoxAdsPlacementDaily" }).map(([code, name]) => [name, {
    count: async ({ where }: { where: Row }) => { checked(where); return (windows[code] ?? []).filter(row => matches(row, where)).length; },
    findMany: async ({ where, take, select }: { where: Row; take: number; select: Row }) => {
      checked(where); assert.equal(take, 3); assert.equal("payload" in select, false);
      return (windows[code] ?? []).filter(row => matches(row, where)).slice(0, take).map(row => Object.fromEntries(Object.keys(select).map(key => [key, row[key]])));
    },
    deleteMany: async ({ where }: { where: Row }) => { checked(where); mutations.push("delete"); windows[code] = (windows[code] ?? []).filter(row => !matches(row, where)); },
    createMany: async ({ data }: { data: Row[] }) => { mutations.push("insert"); batches.push(data.length); if (failInsert) throw Error("private database credentials"); (windows[code] ??= []).push(...data); },
  }]));
  const db = { ...models, sellfoxReportTask: {
    findMany: async ({ where }: { where: Row }) => { queries.push(where); return returnForeign ? tasks : tasks.filter(row => matches(row, where)); },
    update: async ({ where, data }: { where: Row; data: Row }) => { checked(where); mutations.push("task"); const found = tasks.find(row => matches(row, where)); assert.ok(found); Object.assign(found, data); },
    create: async () => { assert.fail("reparse must not create tasks"); },
  }, $transaction: async (fn: (tx: unknown) => Promise<void>) => {
    transactions++;
    const snapshot = structuredClone(windows), statuses = tasks.map(task => task.status);
    try { await fn(db); } catch (error) { for (const code of Object.keys(windows)) delete windows[code]; Object.assign(windows, snapshot); tasks.forEach((task, index) => { task.status = statuses[index]; }); throw error; }
  } };
  const dependencies = { db: db as unknown as NonNullable<Parameters<typeof reparseSellfoxAdsReportsFromCache>[1]>["db"], storage: () => ({ getBuffer: async (key: string) => { reads.push(key); const buffer = files.get(key); if (!buffer) throw Error("ENOENT"); return buffer; } }),
    post: async () => { assert.fail("no createTask/pageList/post"); }, download: async () => { assert.fail("no download"); } };
  return { dependencies, windows, files, reads, mutations, queries, batches, get transactions() { return transactions; }, failInsert: () => { failInsert = true; }, returnForeign: () => { returnForeign = true; } };
}

test("CLI defaults to dry-run, accepts both flag syntaxes, refuses absent scope/unknown flags/types/dates", async () => {
  const args = parseSellfoxAdsReparseArgs(["--organization-id=org", "--workspace-id", "workspace"]);
  assert.equal(args.write, false);
  assert.equal(parseSellfoxAdsReparseArgs(["--write"]).write, true);
  assert.throws(() => parseSellfoxAdsReparseArgs(["--apply"]));
  const f = fixture();
  for (const patch of [{ organizationId: "" }, { workspaceId: "" }, { reportType: "adTargetingReport" }, { reportType: "" }, { taskId: "" }, { adType: "all" }, { startDate: "2026-02-29" }, { startDate: "2026-10-25", endDate: "2026-10-24" }]) {
    await assert.rejects(() => reparseSellfoxAdsReportsFromCache({ ...args, ...patch }, f.dependencies));
  }
  assert.equal(f.queries.length, 0); assert.equal(f.reads.length, 0); assert.equal(f.transactions, 0);
});

test("default dry-run fully parses cached done/downloaded tasks and samples old text/empty IDs with zero writes", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => { assert.fail("no HTTP in reparse"); });
  const tasks = [task("target"), { ...task("search", "adSearchTermReport"), status: "downloaded" }, task("product", "adProductReport"), { ...task("pending"), status: "pending" }];
  const f = fixture(tasks);
  for (const task of tasks) f.files.set(task.fileKey!, await xlsx(task.reportTypeCode));
  const result = await reparseSellfoxAdsReportsFromCache(input, f.dependencies);
  assert.equal(result.mode, "dry-run"); assert.equal(result.selectedTasks, 2); assert.equal(result.failedTasks, 0);
  for (const item of result.results) {
    assert.equal(item.status, "would_write"); assert.equal(item.beforeCount, 1); assert.equal(item.afterCount, 1); assert.equal(item.legacyIdentityCount, 1);
    assert.equal(item.identitySample.after[0].targetingId, "120449591864118");
  }
  assert.equal(result.results[0].identitySample.legacy[0].targetingId, "text:old");
  assert.equal(result.results[1].identitySample.legacy[0].targetingId, ""); assert.equal(result.results[1].identitySample.after[0].searchTerm, "query");
  assert.deepEqual(f.mutations, []); assert.equal(f.transactions, 0); assert.equal(tasks[1].status, "downloaded"); assert.equal(network.mock.callCount(), 0);
});

test("--write replaces whole scoped window, removes old identities, preserves neighbours, and is idempotent", async () => {
  const tasks = [task("target"), { ...task("search", "adSearchTermReport"), status: "downloaded" }], f = fixture(tasks);
  const neighbours = [{ ...legacyRow(), id: "other-tenant", organizationId: "other" }, { ...legacyRow(), id: "other-date", reportDate: "2026-10-23" }, { ...legacyRow(), id: "other-store", storeId: "other" }, { ...legacyRow(), id: "other-ad", adType: "sb" }, { ...legacyRow(), id: "other-workspace", workspaceId: "other" }];
  f.windows.adTargeringReport.push(...neighbours);
  for (const task of tasks) f.files.set(task.fileKey!, await xlsx(task.reportTypeCode));
  const args = parseSellfoxAdsReparseArgs(["--organization-id=org", "--workspace-id=workspace", "--write"]);
  const result = await reparseSellfoxAdsReportsFromCache(args, f.dependencies);
  assert.ok(result.results.every(row => row.status === "written")); assert.equal(f.transactions, 2);
  assert.deepEqual(f.mutations, ["delete", "insert", "task", "delete", "insert", "task"]);
  assert.equal(f.windows.adTargeringReport.length, 6); assert.equal(f.windows.adSearchTermReport.length, 1);
  assert.ok(f.windows.adTargeringReport.includes(neighbours[0]));
  assert.equal(f.windows.adSearchTermReport[0].targetingId, "120449591864118"); assert.equal(tasks[1].status, "done");
  const first = structuredClone(f.windows);
  const repeated = await reparseSellfoxAdsReportsFromCache(args, f.dependencies);
  assert.deepEqual(f.windows, first); assert.ok(repeated.results.every(row => row.afterCount === 1 && row.legacyIdentityCount === 0));
});

test("missing, empty and invalid XLSX refuse only that task and continue without HTTP or task creation", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => { assert.fail("no HTTP fallback"); });
  const tasks = [task("missing"), task("empty"), task("invalid"), task("valid")], f = fixture(tasks);
  f.files.set(tasks[1].fileKey!, Buffer.alloc(0));
  f.files.set(tasks[2].fileKey!, await xlsx("adTargeringReport", { invalid: true }));
  f.files.set(tasks[3].fileKey!, await xlsx("adTargeringReport"));
  const result = await reparseSellfoxAdsReportsFromCache({ ...input, write: true }, f.dependencies);
  assert.deepEqual(result.results.map(row => row.status), ["skipped_missing", "skipped_missing", "parse_failed", "written"]);
  assert.equal(result.failedTasks, 3); assert.equal(f.transactions, 1); assert.equal(network.mock.callCount(), 0);
});

test("wrong org/workspace/task/store scope and foreign cache keys are refused before reading or writing", async () => {
  const f = fixture();
  for (const patch of [{ organizationId: "other" }, { workspaceId: "other" }, { storeId: "other" }, { shopExternalId: "other" }]) {
    await assert.rejects(() => reparseSellfoxAdsReportsFromCache({ ...input, ...patch, taskId: "cached", write: true }, f.dependencies), /任务不在/);
  }
  for (const foreign of [ { ...task("cached"), organizationId: "other" }, { ...task("cached"), SellfoxStore: { ...store, workspaceId: "other" } }, { ...task("cached"), fileKey: "sellfox-reports/other/workspace/cached.xlsx" }, task("../../other/workspace/cached") ]) {
    const injected = fixture([foreign]); injected.returnForeign();
    await assert.rejects(() => reparseSellfoxAdsReportsFromCache({ ...input, write: true }, injected.dependencies), /跨组织|fileKey/);
    assert.equal(injected.reads.length, 0); assert.equal(injected.transactions, 0);
  }
  assert.equal(f.reads.length, 0); assert.equal(f.transactions, 0);
});

test("filters constrain the query, select complete windows only, and never require runId", async () => {
  const f = fixture([task("cached"), { ...task("wide"), startDate: "2026-10-23" }]);
  f.files.set(task("cached").fileKey!, await xlsx("adTargeringReport"));
  const request: SellfoxAdsReparseInput = { ...input, taskId: "cached", reportType: "adTargeringReport", storeId: "store", shopExternalId: "shop", adType: "sp", startDate: "2026-10-24", endDate: "2026-10-24" };
  const result = await reparseSellfoxAdsReportsFromCache(request, f.dependencies);
  assert.equal(result.selectedTasks, 1); assert.equal("runId" in f.queries[0], false);
  const windows = await reparseSellfoxAdsReportsFromCache({ ...input, startDate: request.startDate, endDate: request.endDate }, f.dependencies);
  assert.equal(windows.selectedTasks, 1);
});

test("transaction failure rolls back delete/insert and task checkpoint; batch sizes retain sync limit", async () => {
  const pending = { ...task("cached"), status: "downloaded" }, f = fixture([pending]);
  f.files.set(task("cached").fileKey!, await xlsx("adTargeringReport", { rows: 501 }));
  const original = structuredClone(f.windows); f.failInsert();
  const failed = await reparseSellfoxAdsReportsFromCache({ ...input, write: true }, f.dependencies);
  assert.equal(failed.results[0].status, "write_failed"); assert.deepEqual(f.windows, original); assert.equal(pending.status, "downloaded");
  const good = fixture(); good.files.set(task("cached").fileKey!, f.files.get(task("cached").fileKey!)!);
  await reparseSellfoxAdsReportsFromCache({ ...input, write: true }, good.dependencies);
  assert.deepEqual(good.batches, [500, 1]);
});

test("valid header-only targeting/search-term reports preview zero then clear the complete window on --write", async () => {
  const tasks = [task("target"), task("search", "adSearchTermReport")], f = fixture(tasks);
  for (const task of tasks) f.files.set(task.fileKey!, await xlsx(task.reportTypeCode, { empty: true }));
  const preview = await reparseSellfoxAdsReportsFromCache(input, f.dependencies);
  assert.ok(preview.results.every(row => row.beforeCount === 1 && row.afterCount === 0 && row.status === "would_write"));
  assert.equal(f.transactions, 0);
  const applied = await reparseSellfoxAdsReportsFromCache({ ...input, write: true }, f.dependencies);
  assert.ok(applied.results.every(row => row.status === "written"));
  assert.deepEqual(f.windows.adTargeringReport, []); assert.deepEqual(f.windows.adSearchTermReport, []);
});

for (const code of ["adProductReport", "adCampaignReport", "adGroupReport", "adSpaceReport"] as const) {
  test(`${code} is opt-in and reuses parsing/atomic replace, including valid header-only empty windows`, async () => {
    const f = fixture([task("cached", code)]); f.files.set(task("cached").fileKey!, await xlsx(code));
    assert.equal((await reparseSellfoxAdsReportsFromCache(input, f.dependencies)).selectedTasks, 0);
    const result = await reparseSellfoxAdsReportsFromCache({ ...input, reportType: code, write: true }, f.dependencies);
    assert.equal(result.results[0].status, "written"); assert.equal(f.windows[code].length, 1);
    f.files.set(task("cached").fileKey!, await xlsx(code, { empty: true }));
    const empty = await reparseSellfoxAdsReportsFromCache({ ...input, reportType: code, write: true }, f.dependencies);
    assert.equal(empty.results[0].afterCount, 0); assert.equal(f.windows[code].length, 0);
  });
}

test("cache entrypoint has no HTTP/transport capability or sync scheduling fallback", async () => {
  for (const path of ["src/lib/sellfox/ads-reparse-from-cache.ts", "scripts/sellfox-ads-reparse-from-cache.ts"]) {
    const source = await readFile(path, "utf8");
    assert.doesNotMatch(source, /sellfoxPost|syncSellfoxAdsReports|createTask|pageList|\bfetch\s*\(|\bdownload\s*\(/);
  }
});
