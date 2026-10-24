import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { syncSellfoxAdsReports } from "@/lib/sellfox/ads-report-sync";
import type { sellfoxPost } from "@/lib/sellfox/client";
type Task = Record<string, unknown>;
function fixture() {
  let task: Task | null = null; let sends = 0; let ambiguous = false; let foreign = false; let stored = false; let commits = 0;
  const rows: Task[] = [];
  const tasks = {
    findUnique: async ({ where }: { where: { id: string } }) => task?.id === where.id ? task : null, findUniqueOrThrow: async () => task,
    findFirst: async () => task?.status === "creating" ? task : null,
    create: async ({ data }: { data: Task }) => { task = { ...data }; return task; },
    update: async ({ data }: { data: Task }) => { Object.assign(task!, data); return task; },
  };
  const db = {
    sellfoxStore: { findMany: async () => [{ id: "store", externalId: "shop", name: "Fixture" }] }, sellfoxReportTask: tasks,
    sellfoxAdsProductDaily: { count: async () => rows.length },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => fn({ sellfoxReportTask: tasks, sellfoxAdsProductDaily: { deleteMany: async () => { rows.length = 0; }, createMany: async ({ data }: { data: Task[] }) => { commits++; rows.push(...data); } } }),
  } as unknown as NonNullable<Parameters<typeof syncSellfoxAdsReports>[1]>["db"];
  const post = (async (path: string) => {
    if (path.includes("createTask")) { sends++; if (ambiguous) throw Error("private timeout with secret URL"); return { id: "remote-task" }; }
    return { rows: [{ id: "remote-task", shopId: [foreign ? "other" : "shop"], adTypeCode: "sp", reportTypeCode: "adProductReport", timeUnit: "daily", reportState: "已生成", downloadUrl: ["https://s1.sellfox.com/report.xlsx"] }] };
  }) as typeof sellfoxPost;
  async function buffer() {
    const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("sheet");
    sheet.addRow(["店铺", "日期", "asin", "sku", "广告活动ID", "广告组ID", "广告产品ID", "广告曝光量", "广告点击量", "广告花费", "广告订单量", "广告销售额"]);
    sheet.addRow(["Fixture", new Date("2026-10-24T00:00:00Z"), "ASIN", "MSKU", "campaign", "group", "product", 10, 1, 1.5, 1, 10]);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }
  const storage = () => ({ putBuffer: async () => { stored = true; }, getBuffer: buffer }) as unknown as ReturnType<NonNullable<Parameters<typeof syncSellfoxAdsReports>[1]>["storage"]>;
  return { dependencies: { db, post, storage, download: buffer, sleep: async () => undefined }, timeout: () => { ambiguous = true; }, foreign: () => { foreign = true; }, get task() { return task; }, get sends() { return sends; }, get stored() { return stored; }, get commits() { return commits; }, get rows() { return rows; } };
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
