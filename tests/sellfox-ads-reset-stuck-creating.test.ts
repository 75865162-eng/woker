import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  parseSellfoxAdsResetStuckCreatingArgs,
  resetSellfoxAdsStuckCreating,
  STUCK_CREATING_RESET_NOTE,
  type SellfoxAdsResetStuckCreatingInput,
} from "@/lib/sellfox/ads-reset-stuck-creating";

type Row = Record<string, unknown>;
const scope = { organizationId: "org", workspaceId: "workspace" };
const store = { ...scope, id: "store", externalId: "shop-1", name: "Fixture Shop" };

function stuck(id: string, patch: Partial<Row> = {}): Row {
  return {
    ...scope,
    id,
    storeId: store.id,
    runId: "run-1",
    reportTypeCode: "adTargeringReport",
    adType: "sd",
    startDate: "2026-10-24",
    endDate: "2026-10-25",
    status: "creating",
    externalTaskId: null,
    fileKey: null,
    updatedAt: new Date("2026-10-26T00:00:00.000Z"),
    SellfoxStore: { ...store },
    ...patch,
  };
}

function fixture(tasks: Row[] = [stuck("t1")], runs: Row[] = [{ id: "run-1", organizationId: "org", workspaceId: "workspace", executionAttempts: 2 }]) {
  const mutations: string[] = [];
  const queries: Row[] = [];
  let deleted = false;
  let returnUnfiltered = false;
  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === "SellfoxStore") return matches(row[key] as Row, value as Row);
      if (value && typeof value === "object" && !(value instanceof Date)) {
        return Object.entries(value as Row).every(([op, operand]) => {
          if (op === "in") return (operand as unknown[]).includes(row[key]);
          if (op === "lte") return new Date(String(row[key])).getTime() <= new Date(String(operand)).getTime();
          throw Error(`unsupported ${op}`);
        });
      }
      return row[key] === value;
    });
  }
  const db = {
    sellfoxReportTask: {
      findMany: async ({ where }: { where: Row }) => {
        queries.push(where);
        assert.equal(where.status, "creating");
        assert.equal(where.externalTaskId, null);
        assert.equal(where.fileKey, null);
        assert.equal(where.organizationId, "org");
        assert.equal(where.workspaceId, "workspace");
        return returnUnfiltered ? tasks : tasks.filter((row) => matches(row, where));
      },
      updateMany: async ({ where, data }: { where: Row; data: Row }) => {
        mutations.push("updateMany");
        assert.equal(data.status, "failed");
        assert.equal(Object.keys(data).length, 1);
        assert.equal(where.status, "creating");
        assert.equal(where.externalTaskId, null);
        assert.equal(where.fileKey, null);
        const ids = (where.id as { in: string[] }).in;
        let count = 0;
        for (const row of tasks) {
          if (!ids.includes(row.id as string)) continue;
          if (row.status !== "creating" || row.externalTaskId != null || row.fileKey != null) continue;
          if (row.organizationId !== "org" || row.workspaceId !== "workspace") continue;
          row.status = "failed";
          count++;
        }
        return { count };
      },
      delete: async () => { deleted = true; assert.fail("must never delete"); },
      deleteMany: async () => { deleted = true; assert.fail("must never delete"); },
    },
    sellfoxSyncRun: {
      findMany: async ({ where }: { where: Row }) => {
        queries.push(where);
        assert.equal(where.organizationId, "org");
        assert.equal(where.workspaceId, "workspace");
        const ids = (where.id as { in: string[] }).in;
        return runs.filter((run) => ids.includes(run.id as string));
      },
    },
  };
  return {
    dependencies: { db: db as unknown as NonNullable<Parameters<typeof resetSellfoxAdsStuckCreating>[1]>["db"] },
    tasks, mutations, queries, get deleted() { return deleted; },
    returnUnfiltered: () => { returnUnfiltered = true; },
  };
}

test("CLI defaults to dry-run and rejects bad scope/filters", async () => {
  const args = parseSellfoxAdsResetStuckCreatingArgs(["--organization-id=org", "--workspace-id", "workspace"]);
  assert.equal(args.write, false);
  assert.equal(parseSellfoxAdsResetStuckCreatingArgs(["--write"]).write, true);
  assert.equal(parseSellfoxAdsResetStuckCreatingArgs(["--older-than-minutes=30"]).olderThanMinutes, 30);
  assert.throws(() => parseSellfoxAdsResetStuckCreatingArgs(["--apply"]));
  assert.throws(() => parseSellfoxAdsResetStuckCreatingArgs(["--older-than-minutes=-1"]));
  assert.throws(() => parseSellfoxAdsResetStuckCreatingArgs(["--older-than-minutes=1.5"]));
  const f = fixture();
  for (const patch of [
    { organizationId: "" },
    { workspaceId: "" },
    { reportTypeCode: "adTargetingReport" },
    { reportTypeCode: "" },
    { taskId: "" },
    { adType: "all" },
    { olderThanMinutes: -1 },
  ] as Partial<SellfoxAdsResetStuckCreatingInput>[]) {
    await assert.rejects(() => resetSellfoxAdsStuckCreating({ ...args, ...patch }, f.dependencies));
  }
  assert.equal(f.queries.length, 0);
  assert.equal(f.mutations.length, 0);
});

test("default dry-run lists stuck creating rows with shop/attempts and never writes", async (t) => {
  const network = t.mock.method(globalThis, "fetch", async () => { assert.fail("no HTTP"); });
  const tasks = [
    stuck("sd-1"),
    stuck("sd-2", { adType: "sd", updatedAt: new Date("2026-10-26T01:00:00.000Z") }),
    stuck("has-ext", { externalTaskId: "remote", status: "creating" }),
    stuck("has-file", { fileKey: "sellfox-reports/org/workspace/x.xlsx", status: "creating" }),
    stuck("pending", { status: "pending" }),
    stuck("sp-done", { adType: "sp", status: "done", fileKey: "k", externalTaskId: "x" }),
  ];
  const f = fixture(tasks);
  const summary = await resetSellfoxAdsStuckCreating(scope, f.dependencies);
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.selectedTasks, 2);
  assert.equal(summary.updatedTasks, 0);
  assert.equal(summary.lastError, STUCK_CREATING_RESET_NOTE);
  assert.deepEqual(summary.tasks.map((task) => task.id), ["sd-1", "sd-2"]);
  assert.equal(summary.tasks[0].shop, "shop-1");
  assert.equal(summary.tasks[0].reportTypeCode, "adTargeringReport");
  assert.equal(summary.tasks[0].adType, "sd");
  assert.equal(summary.tasks[0].status, "creating");
  assert.equal(summary.tasks[0].attempts, 2);
  assert.equal(summary.tasks[0].lastError, STUCK_CREATING_RESET_NOTE);
  assert.equal(f.mutations.length, 0);
  assert.equal(tasks.find((row) => row.id === "sd-1")!.status, "creating");
  assert.equal(network.mock.callCount(), 0);
  assert.equal(f.deleted, false);
});

test("--write marks only matching stuck rows failed and never touches externalTaskId rows", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("no HTTP"); });
  const protectedRow = stuck("has-ext", { externalTaskId: "remote-id" });
  const tasks = [stuck("sd-1"), protectedRow, stuck("sp-1", { adType: "sp" })];
  const f = fixture(tasks);
  const preview = await resetSellfoxAdsStuckCreating({ ...scope, reportTypeCode: "adTargeringReport", adType: "sd" }, f.dependencies);
  assert.equal(preview.selectedTasks, 1);
  assert.equal(preview.updatedTasks, 0);
  const applied = await resetSellfoxAdsStuckCreating({ ...scope, reportTypeCode: "adTargeringReport", adType: "sd", write: true }, f.dependencies);
  assert.equal(applied.mode, "write");
  assert.equal(applied.selectedTasks, 1);
  assert.equal(applied.updatedTasks, 1);
  assert.equal(applied.tasks[0].status, "failed");
  assert.equal(tasks.find((row) => row.id === "sd-1")!.status, "failed");
  assert.equal(protectedRow.status, "creating");
  assert.equal(protectedRow.externalTaskId, "remote-id");
  assert.equal(tasks.find((row) => row.id === "sp-1")!.status, "creating");
  assert.equal(f.mutations.length, 1);
});

test("filters intersect and explicit task-id outside scope rejects", async () => {
  const tasks = [
    stuck("a", { adType: "sd", reportTypeCode: "adTargeringReport", updatedAt: new Date("2026-10-20T00:00:00.000Z") }),
    stuck("b", { adType: "sp", reportTypeCode: "adTargeringReport", updatedAt: new Date("2026-10-20T00:00:00.000Z") }),
    stuck("c", { adType: "sd", reportTypeCode: "adProductReport", updatedAt: new Date("2026-10-20T00:00:00.000Z") }),
    stuck("fresh", { updatedAt: new Date(Date.now() - 60_000) }),
  ];
  const f = fixture(tasks);
  const filtered = await resetSellfoxAdsStuckCreating({
    ...scope, reportTypeCode: "adTargeringReport", adType: "sd", olderThanMinutes: 60 * 24,
  }, f.dependencies);
  assert.deepEqual(filtered.tasks.map((task) => task.id), ["a"]);
  await assert.rejects(
    () => resetSellfoxAdsStuckCreating({ ...scope, taskId: "missing", write: true }, f.dependencies),
    /不满足卡住 creating/,
  );
  assert.equal(f.mutations.length, 0);
});

test("cross-tenant store rows are rejected before any write", async () => {
  const tasks = [stuck("bad", { SellfoxStore: { ...store, organizationId: "other" } })];
  const f = fixture(tasks);
  f.returnUnfiltered();
  await assert.rejects(() => resetSellfoxAdsStuckCreating({ ...scope, write: true }, f.dependencies), /跨组织/);
  assert.equal(f.mutations.length, 0);
  assert.equal(tasks[0].status, "creating");
});

test("script and library never expose Sellfox HTTP helpers", async () => {
  for (const path of ["src/lib/sellfox/ads-reset-stuck-creating.ts", "scripts/sellfox-ads-reset-stuck-creating.ts"]) {
    const source = await readFile(path, "utf8");
    assert.equal(/sellfoxPost|\/api\/cpc\/|pageList\.json|\bfetch\s*\(|\.deleteMany\s*\(|\$executeRaw/.test(source), false);
  }
});
