import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const compiled = ts.transpileModule(readFileSync(new URL("../src/components/workspace/use-campaign-file-transfer.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness() {
  let scope = { workspaceId: "a", accountId: "account", marketplace: "US" };
  const cleanups: Array<() => void> = []; const writes: unknown[] = []; const alerts: string[] = [];
  const reads: Array<(value: unknown) => void> = [];
  const listeners = new Map<string, () => void>();
  const store = Object.assign(() => ({ importGroupingStatusCsv: (...args: unknown[]) => { writes.push(args); return { importedRows: 1, workspaceUnitCount: 1 }; }, ingestOverallAdDataCsvFiles: (...args: unknown[]) => writes.push(args), activateOverallAdDataForScope: (...args: unknown[]) => writes.push(args), openCampaignGroup: (...args: unknown[]) => writes.push(args), setActiveWorkspaceUnit: () => {} }), { getState: () => ({ overallAdDataRows: [], overallAdDataMatchSummary: { matchedCampaignGroups: 1 } }) });
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  runInNewContext(compiled, {
    exports, setTimeout: () => 1, clearTimeout: () => {},
    window: { alert: (message: string) => alerts.push(message), addEventListener: (name: string, fn: () => void) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) },
    require: (name: string) => {
      if (name === "react") return { useRef: (current: unknown) => ({ current }), useState: (initial: unknown) => [initial, () => {}], useEffect: (fn: () => () => void) => cleanups.push(fn()) };
      if (name.endsWith("workspace-store")) return { useWorkspaceStore: store };
      if (name.endsWith("workspace-scope-store")) return { readWorkspaceScope: () => scope };
      if (name.endsWith("workspace-scope-events")) return { workspaceScopeChangedEventName: "scope" };
      if (name === "./campaign-grid-home-utils") return { readGroupingStatusFile: () => new Promise(resolve => reads.push(resolve)), readOverallImportFile: () => new Promise(resolve => reads.push(resolve)), countMatchedOverallKeywords: () => 0, sameScope: () => false };
      throw new Error(name);
    },
  });
  type Session = { selectOverallFiles: (ids: string[]) => void; handleOverallSelected: (files: unknown) => Promise<void>; handleGroupingStatusSelected: (file: unknown) => Promise<void> };
  const session = exports.useCampaignFileTransfer([], []) as Session;
  return { session, reads, writes, alerts, change(accountId = "other") { scope = { ...scope, accountId }; }, reset() { listeners.get("scope")?.(); }, dispose() { cleanups.forEach(fn => fn()); } };
}

test("Overall解析保留选择的广告组范围，更新store并显示真实零匹配", async () => {
  const h = harness(); h.session.selectOverallFiles(["group-a"]);
  const pending = h.session.handleOverallSelected([{ name: "overall.csv" }]);
  h.session.selectOverallFiles(["group-b"]);
  h.reads[0]({ name: "overall.csv", text: "fixture" }); await pending;
  assert.equal(JSON.stringify(h.writes[0]), '[[{"name":"overall.csv","text":"fixture"}],["group-a"]]');
  assert.match(h.alerts[0], /0 个关键词/);
});

test("账号scope切换及卸载后迟到文件解析不能写入当前store", async () => {
  for (const invalidate of [(h: ReturnType<typeof harness>) => h.change(), (h: ReturnType<typeof harness>) => h.dispose(), (h: ReturnType<typeof harness>) => h.reset()]) {
    const h = harness(); h.session.selectOverallFiles(["group"]);
    const pending = h.session.handleOverallSelected([{ name: "overall.xlsx" }]);
    invalidate(h); h.reads[0]({ name: "overall.xlsx" }); await pending;
    assert.equal(h.writes.length, 0); assert.equal(h.alerts.length, 0);
  }
});

test("分组导入也拒绝scope切换或卸载后的迟到结果", async () => {
  for (const dispose of [false, true]) {
    const h = harness(); const pending = h.session.handleGroupingStatusSelected({ name: "group.csv" });
    if (dispose) h.dispose(); else h.change();
    h.reads[0]("fixture"); await pending;
    assert.equal(h.writes.length, 0);
  }
});
