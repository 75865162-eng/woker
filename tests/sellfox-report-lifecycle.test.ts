import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { syncSellfoxAdsReports, type SellfoxCpcReportType } from "@/lib/sellfox/ads-report-sync";
import { SellfoxRequestError, type sellfoxPost } from "@/lib/sellfox/client";
type Task = Record<string, unknown>;
function fixture(reportTypeCode: SellfoxCpcReportType = "adProductReport") {
  let task: Task | null = null; let sends = 0; let ambiguous = false; let definiteReject = false; let missingId = false; let foreign = false; let stored = false; let commits = 0; let invalidContract = false;
  const rows: Task[] = [];
  const model = ({ adProductReport: "sellfoxAdsProductDaily", adTargeringReport: "sellfoxAdsTargetingDaily", adSearchTermReport: "sellfoxAdsSearchTermDaily", adCampaignReport: "sellfoxAdsCampaignDaily", adGroupReport: "sellfoxAdsAdGroupDaily", adSpaceReport: "sellfoxAdsPlacementDaily" } as const)[reportTypeCode];
  const tasks = {
    findUnique: async ({ where }: { where: { id: string } }) => task?.id === where.id ? task : null, findUniqueOrThrow: async () => task,
    findFirst: async ({ where }: { where: Task }) => task?.status === "creating" && task.reportTypeCode === where.reportTypeCode ? task : null,
    create: async ({ data }: { data: Task }) => { task = { ...data }; return task; },
    update: async ({ data }: { data: Task }) => { Object.assign(task!, data); return task; },
  };
  const db = {
    sellfoxStore: { findMany: async () => [{ id: "store", externalId: "shop", name: "Fixture" }] }, sellfoxReportTask: tasks,
    [model]: { count: async () => rows.length },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const daily = { deleteMany: async ({ where }: { where: Task }) => { assert.equal(where.organizationId, "org"); assert.equal(where.workspaceId, "workspace"); rows.length = 0; }, createMany: async ({ data }: { data: Task[] }) => { commits++; rows.push(...data); } };
      return fn({ sellfoxReportTask: tasks, [model]: daily });
    },
  } as unknown as NonNullable<Parameters<typeof syncSellfoxAdsReports>[1]>["db"];
  const post = (async (path: string, body: Task, options?: Task) => {
    if (path.includes("createTask")) {
      assert.equal(body.reportTypeCode, reportTypeCode); assert.equal(body.timeUnit, "daily"); assert.deepEqual(body.shopIds, ["shop"]); assert.equal(options?.retry, false);
      sends++;
      if (ambiguous) throw new SellfoxRequestError("赛狐接口请求超时（30 秒）。", true);
      if (definiteReject) throw new SellfoxRequestError("赛狐接口调用失败（HTTP 400 / 10001）。", false, 10001);
      if (missingId) return { id: 12345 };
      return { id: "remote-task" };
    }
    return { rows: [{ id: "remote-task", shopId: [foreign ? "other" : "shop"], adTypeCode: "sp", reportTypeCode, timeUnit: "daily", reportState: "已生成", downloadUrl: ["https://s1.sellfox.com/report.xlsx"] }] };
  }) as typeof sellfoxPost;
  async function buffer() {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("sheet");
    const raw = { 店铺: "Fixture", 日期: new Date("2026-10-24T00:00:00Z"), asin: "ASIN", sku: "MSKU", 广告活动ID: invalidContract ? "" : "campaign", 广告曝光量: 10, 广告点击量: 1, 广告花费: 1.5, 广告订单量: 1, 广告销售额: 10,
      ...(reportTypeCode === "adCampaignReport" ? { 广告活动名称: "Campaign" } : reportTypeCode === "adSpaceReport" ? { 广告位: "topOfSearch" } : { 广告组ID: "group" }),
      ...(reportTypeCode === "adProductReport" ? { 广告产品ID: "product" } : reportTypeCode === "adTargeringReport" ? { 投放ID: "product" } : reportTypeCode === "adSearchTermReport" ? { 用户搜索词: "product" } : {}) };
    sheet.addRow(Object.keys(raw)); sheet.addRow(Object.values(raw));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  const storage = () => ({ putBuffer: async () => { stored = true; }, getBuffer: buffer }) as unknown as ReturnType<NonNullable<Parameters<typeof syncSellfoxAdsReports>[1]>["storage"]>;
  return {
    dependencies: { db, post, storage, download: buffer, sleep: async () => undefined },
    contract: (invalid: boolean) => { invalidContract = invalid; },
    timeout: () => { ambiguous = true; },
    reject: (enabled = true) => { definiteReject = enabled; },
    missingId: (enabled = true) => { missingId = enabled; },
    foreign: () => { foreign = true; },
    get task() { return task; }, get sends() { return sends; }, get stored() { return stored; }, get commits() { return commits; }, get rows() { return rows; },
  };
}
const input = { runId: "run", organizationId: "org", workspaceId: "workspace", shopExternalIds: ["shop"], startDate: "2026-10-24", endDate: "2026-10-24", onProgress: async () => undefined };
test("ambiguous task creation survives retries and even a new run without duplicate HTTP", async () => {
  const f = fixture(); f.timeout();
  await assert.rejects(() => syncSellfoxAdsReports(input, f.dependencies));
  assert.equal(f.task?.status, "creating"); assert.equal(f.sends, 1);
  await assert.rejects(() => syncSellfoxAdsReports(input, f.dependencies));
  await assert.rejects(() => syncSellfoxAdsReports({ ...input, runId: "new-run" }, f.dependencies));
  assert.equal(f.sends, 1); assert.equal(f.commits, 0);
});
test("known task resumes through storage into narrow metrics, repeated run skips transport", async () => {
  const f = fixture();
  await syncSellfoxAdsReports(input, f.dependencies);
  assert.equal(f.stored, true); assert.equal(f.task?.status, "done"); assert.equal(f.rows[0].adOrders, 1); assert.equal(f.rows[0].currency, null);
  assert.equal(f.rows[0].organizationId, "org"); assert.equal(f.rows[0].workspaceId, "workspace");
  await syncSellfoxAdsReports(input, f.dependencies);
  assert.equal(f.sends, 1); assert.equal(f.commits, 1);
});
test("foreign report ownership is rejected before download or daily writes", async () => {
  const f = fixture(); f.foreign();
  await assert.rejects(() => syncSellfoxAdsReports(input, f.dependencies));
  assert.equal(f.task?.externalTaskId, "remote-task"); assert.equal(f.stored, false); assert.equal(f.commits, 0);
});

for (const reportTypeCode of ["adTargeringReport", "adSearchTermReport", "adCampaignReport", "adGroupReport", "adSpaceReport"] as const) {
  test(`${reportTypeCode} uses exact report code and retries a completed task without duplicate createTask or writes`, async () => {
    const f = fixture(reportTypeCode);
    const request = { ...input, reportTypeCode };
    await syncSellfoxAdsReports(request, f.dependencies);
    assert.equal(f.task?.reportTypeCode, reportTypeCode); assert.equal(f.task?.status, "done"); assert.equal(f.commits, 1);
    const identity = ({ adTargeringReport: ["targetingId", "product"], adSearchTermReport: ["searchTerm", "product"], adCampaignReport: ["campaignId", "campaign"], adGroupReport: ["adGroupId", "group"], adSpaceReport: ["placement", "topOfSearch"] } as const)[reportTypeCode];
    assert.equal(f.rows[0][identity[0]], identity[1]);
    if (reportTypeCode === "adCampaignReport") assert.equal("adGroupId" in f.rows[0], false);
    if (reportTypeCode === "adSpaceReport") assert.equal(f.rows[0].adGroupId, null);
    assert.equal(f.rows[0].currency, null);
    assert.equal(f.task?.id, createHash("sha256").update(JSON.stringify(["run", "store", "sp", reportTypeCode])).digest("hex"));
    await syncSellfoxAdsReports(request, f.dependencies);
    assert.equal(f.sends, 1); assert.equal(f.commits, 1);
  });
  test(`${reportTypeCode} ambiguous creation survives same/new run retries and foreign ownership cannot commit`, async () => {
    const f = fixture(reportTypeCode); f.timeout();
    for (const runId of ["run", "run", "new-run"]) await assert.rejects(() => syncSellfoxAdsReports({ ...input, runId, reportTypeCode }, f.dependencies));
    assert.equal(f.sends, 1); assert.equal(f.commits, 0);
    const foreign = fixture(reportTypeCode); foreign.foreign();
    await assert.rejects(() => syncSellfoxAdsReports({ ...input, reportTypeCode }, foreign.dependencies));
    assert.equal(foreign.stored, false); assert.equal(foreign.commits, 0);
  });
}
for (const reportTypeCode of ["adCampaignReport", "adGroupReport", "adSpaceReport"] as const) {
  test(`${reportTypeCode} contract failure retains existing window; corrected cached parse never creates or downloads again`, async () => {
    const f = fixture(reportTypeCode), old = { id: "old", cost: 99 };
    f.rows.push(old); f.contract(true);
    await assert.rejects(() => syncSellfoxAdsReports({ ...input, reportTypeCode }, f.dependencies));
    assert.equal(f.task?.status, "downloaded"); assert.equal(f.commits, 0); assert.deepEqual(f.rows, [old]);
    f.contract(false);
    const noTransport = async () => { throw new Error("cached recovery cannot call transport"); };
    await syncSellfoxAdsReports({ ...input, reportTypeCode }, { ...f.dependencies, post: noTransport as typeof sellfoxPost, download: noTransport });
    assert.equal(f.sends, 1); assert.equal(f.commits, 1); assert.equal(f.rows[0].cost, 1.5);
  });
}
test("legacy product task hash resumes after reportTypeCode backfill without another createTask", async () => {
  const f = fixture();
  await syncSellfoxAdsReports(input, f.dependencies);
  f.task!.id = createHash("sha256").update(JSON.stringify([input.runId, "store", "sp"])).digest("hex");
  await syncSellfoxAdsReports(input, f.dependencies);
  assert.equal(f.sends, 1); assert.equal(f.commits, 1);
});

test("new report downloaded checkpoint resumes from storage without any HTTP after a fenced commit failure", async () => {
  const reportTypeCode = "adCampaignReport" as const, f = fixture(reportTypeCode);
  await assert.rejects(() => syncSellfoxAdsReports({ ...input, reportTypeCode, onProgress: async progress => {
    if ((progress.cursor as Task)?.status === "committing") throw new Error("fixture lease lost");
  } }, f.dependencies));
  assert.equal(f.task?.status, "downloaded"); assert.equal(f.commits, 0);
  await syncSellfoxAdsReports({ ...input, reportTypeCode }, { ...f.dependencies, post: (async () => { throw new Error("cached retry must not send HTTP"); }) as typeof sellfoxPost });
  assert.equal(f.sends, 1); assert.equal(f.commits, 1);
});
test("report type returned by pageList must match the requested type before downloading", async () => {
  const f = fixture("adSearchTermReport");
  const post = (async (...args: Parameters<typeof sellfoxPost>) => {
    const response = await f.dependencies.post<{ rows?: Task[] }>(...args);
    if (response.rows) response.rows[0].reportTypeCode = "adProductReport";
    return response;
  }) as typeof sellfoxPost;
  await assert.rejects(() => syncSellfoxAdsReports({ ...input, reportTypeCode: "adSearchTermReport" }, { ...f.dependencies, post }));
  assert.equal(f.stored, false); assert.equal(f.commits, 0);
});

test("definite createTask reject marks failed and same-run retry may resubmit without leaving creating", async () => {
  const f = fixture("adTargeringReport"); f.reject();
  const request = { ...input, reportTypeCode: "adTargeringReport" as const };
  await assert.rejects(() => syncSellfoxAdsReports(request, f.dependencies), /HTTP 400 \/ 10001|原因示例/);
  assert.equal(f.task?.status, "failed"); assert.equal(f.task?.externalTaskId, undefined); assert.equal(f.sends, 1);
  f.reject(false);
  await syncSellfoxAdsReports(request, f.dependencies);
  assert.equal(f.sends, 2); assert.equal(f.task?.status, "done"); assert.equal(f.commits, 1);
});
test("missing createTask id is definite failure and unblocks a later create", async () => {
  const f = fixture("adTargeringReport"); f.missingId();
  const request = { ...input, reportTypeCode: "adTargeringReport" as const };
  await assert.rejects(() => syncSellfoxAdsReports(request, f.dependencies), /缺少 ID|原因示例/);
  assert.equal(f.task?.status, "failed"); assert.equal(f.sends, 1);
  f.missingId(false);
  await syncSellfoxAdsReports(request, f.dependencies);
  assert.equal(f.sends, 2); assert.equal(f.task?.status, "done");
});
test("createTask timeout stays creating and still blocks same or new runs", async () => {
  const f = fixture("adTargeringReport"); f.timeout();
  const request = { ...input, reportTypeCode: "adTargeringReport" as const };
  await assert.rejects(() => syncSellfoxAdsReports(request, f.dependencies), /请求超时|原因示例/);
  assert.equal(f.task?.status, "creating"); assert.equal(f.sends, 1);
  await assert.rejects(() => syncSellfoxAdsReports(request, f.dependencies));
  await assert.rejects(() => syncSellfoxAdsReports({ ...request, runId: "new-run" }, f.dependencies));
  assert.equal(f.sends, 1); assert.equal(f.commits, 0);
});
