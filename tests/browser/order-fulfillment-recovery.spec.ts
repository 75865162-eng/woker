import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
let bundle = "";
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import React, { useState } from 'react'; import { createRoot } from 'react-dom/client'; import { OrderFulfillmentRecoveryPanel } from './src/components/operations/order-fulfillment-recovery-panel'; const headers = () => new Headers({'x-workspace-id':localStorage.getItem('workspace') || 'fixture-a'}); function Fixture() { const [source, setSource] = useState('source-a'), [opened, setOpened] = useState(false); return <><button onClick={() => setSource('source-b')}>切换任务</button><button onClick={() => {localStorage.setItem('workspace','fixture-b');window.dispatchEvent(new Event('amazon-bulk-ad:workspace-scope-changed'));}}>切换工作区</button>{opened && <p>变更审批已打开</p>}<OrderFulfillmentRecoveryPanel sourceId={source} taskId={'task-'+source} sellerName={source} marketplaceId="US" busy={false} requestHeaders={headers} requestApproval={async command => {const response=await fetch('/api/operations/sync-center',{method:'POST',headers:headers(),body:JSON.stringify(command)});return response.ok;}} openApprovals={() => setOpened(true)}/></>; } createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
});
const preview = (source = "source-a", changedRows = 2) => ({ started: false, rawValuesIncluded: false, recoveryDigest: "a".repeat(64), manifest: { checkedRows: 5, changedRows, addedFields: changedRows * 2, parserVersion: "orders.2026-01-01.v2", archives: [{ page: 1 }, { page: 2 }] }, command: { action: "recover-report", id: source, taskId: `task-${source}`, revision: 7, orderFulfillmentOnly: true, rawPages: [1, 2], recoveryDigest: "a".repeat(64) } });
async function setup(page: Page) {
  const reads: Array<{ source: string | null; pages: string | null; workspace: string }> = [], writes: unknown[] = [];
  const state = { historyDelayed: false, historyDenied: false, discoveryDelayed: false, denied: false, empty: false, failed: false, delayed: false, release: () => {} };
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()); expect(url.origin).toBe("http://127.0.0.1:43229");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      if (request.method() === "POST") { writes.push(request.postDataJSON()); return route.fulfill({ status: state.failed ? 409 : 202, json: state.failed ? { error: "版本已变化" } : { changeRequest: { id: "approval-fixture", status: "REQUESTED" } } }); }
      if (url.searchParams.get("section") === "order-fulfillment-history") {
        if (state.historyDelayed) { state.historyDelayed = false; await new Promise<void>(resolve => { state.release = resolve; }); }
        return route.fulfill({ status: state.historyDenied ? 403 : 200, json: state.historyDenied ? { error: "批次范围已撤销" } : { batches: [{ id: "past-applied", status: "APPLIED", pages: [3, 7], changedRows: 2 }, { id: "past-requested", status: "REQUESTED", pages: [12], changedRows: 1 }], hasMore: false } }).catch(() => {});
      }
      if (url.searchParams.get("section") === "order-fulfillment-pages") {
        if (state.discoveryDelayed) { state.discoveryDelayed = false; await new Promise<void>(resolve => { state.release = resolve; }); }
        const next = url.searchParams.get("after") === "7";
        return route.fulfill({ json: { pages: next ? [12] : [3, 7], nextCursor: next ? null : 7, hasNext: !next, batchSize: 10 } }).catch(() => {});
      }
      expect(url.searchParams.get("section")).toBe("order-fulfillment-preview");
      const source = url.searchParams.get("sourceId");
      expect(url.searchParams.get("taskId")).toBe(`task-${source}`);
      reads.push({ source, pages: url.searchParams.get("rawPages"), workspace: request.headers()["x-workspace-id"] });
      if (state.delayed) { state.delayed = false; await new Promise<void>(resolve => { state.release = resolve; }); }
      return route.fulfill({ status: state.denied ? 403 : 200, json: state.denied ? { error: "范围已撤销" } : preview(source!, state.empty ? 0 : 2) }).catch(() => {});
    }
    expect(request.method()).toBe("GET");
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43229/");
  return { state, reads, writes };
}
async function load(page: Page) { await page.getByLabel("原件页（最多 10 页）").fill("1, 2"); await page.getByRole("button", { name: "预览履约补齐" }).click(); }

test("preview shows exact effects and submits only the server command for later approval", async ({ page }) => {
  const { reads, writes } = await setup(page); await load(page);
  await expect(page.getByText("已核对 5 行，拟补齐 2 行、4 个字段值。", { exact: true })).toBeVisible();
  expect(reads[0]).toEqual({ source: "source-a", pages: "1,2", workspace: "fixture-a" }); expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "提交履约补齐审批" }).click();
  await expect(page.getByRole("status")).toContainText("尚未改写数据"); expect(writes).toEqual([preview().command]);
  await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toHaveCount(0);
  await page.getByRole("button", { name: "前往变更审批" }).click(); await expect(page.getByText("变更审批已打开")).toBeVisible();
});

test("invalid ranges never query; edits, empty results and denied refresh remove actionable preview", async ({ page }) => {
  const { state, reads, writes } = await setup(page);
  for (const value of ["0", "1,1", "1.5", "1,2,3,4,5,6,7,8,9,10,11"]) {
    await page.getByLabel("原件页（最多 10 页）").fill(value); await page.getByRole("button", { name: "预览履约补齐" }).click();
    await expect(page.getByRole("alert")).toContainText("不重复的正整数");
  }
  expect(reads).toHaveLength(0); await load(page); await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toBeVisible();
  await page.getByLabel("原件页（最多 10 页）").fill("3"); await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toHaveCount(0);
  state.empty = true; await page.getByRole("button", { name: "预览履约补齐" }).click(); await expect(page.getByRole("status")).toContainText("没有可补齐");
  state.denied = true; await page.getByRole("button", { name: "预览履约补齐" }).click(); await expect(page.getByRole("alert")).toHaveText("范围已撤销");
  await expect(page.getByText("已核对", { exact: false })).toHaveCount(0); expect(writes).toHaveLength(0);
});

test("workspace switch discards delayed responses and requires a fresh preview in the new workspace", async ({ page }) => {
  const { state, reads, writes } = await setup(page); state.delayed = true; await load(page);
  await expect.poll(() => reads.length).toBe(1); await page.getByRole("button", { name: "切换工作区" }).click(); state.release();
  await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("");
  await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toHaveCount(0);
  await load(page); await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toBeVisible(); expect(reads[1].workspace).toBe("fixture-b"); expect(writes).toHaveLength(0);
});

test("task switch clears old preview and failed submissions require re-preview", async ({ page }) => {
  const { state, writes } = await setup(page); await load(page); await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toBeVisible();
  await page.getByRole("button", { name: "切换任务" }).click(); await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("");
  await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toHaveCount(0); await load(page);
  state.failed = true; await page.getByRole("button", { name: "提交履约补齐审批" }).click(); await expect(page.getByRole("alert")).toContainText("重新预览");
  expect(writes).toEqual([preview("source-b").command]); await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toHaveCount(0);
});


test("discovers sparse actual archive pages in batches and invalidates previous preview", async ({ page }) => {
  const { reads, writes } = await setup(page);
  await page.getByRole("button", { name: "自动查找原件页" }).click();
  await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("3,7");
  await page.getByRole("button", { name: "预览履约补齐" }).click();
  await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toBeVisible();
  expect(reads[0].pages).toBe("3,7"); expect(writes).toHaveLength(0);
  await page.getByRole("button", { name: "选择下一批原件" }).click();
  await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("12");
  await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "选择下一批原件" })).toHaveCount(0);
  await page.getByRole("button", { name: "切换任务" }).click();
  await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("");
  await expect(page.getByText("已选择真实原件页", { exact: false })).toHaveCount(0);
});


test("workspace change discards delayed archive discovery", async ({ page }) => {
  const { state, writes } = await setup(page); state.discoveryDelayed = true;
  await page.getByRole("button", { name: "自动查找原件页" }).click();
  await expect(page.getByText("正在处理…")).toBeVisible();
  await page.getByRole("button", { name: "切换工作区" }).click(); state.release();
  await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("");
  await expect(page.getByRole("button", { name: "选择下一批原件" })).toHaveCount(0);
  await page.getByRole("button", { name: "自动查找原件页" }).click();
  await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("3,7"); expect(writes).toHaveLength(0);
});


test("persisted batch history distinguishes applied from requested and restores pages with fresh preview", async ({ page }) => {
  const { reads, writes, state } = await setup(page);
  await page.getByRole("button", { name: "刷新补齐批次记录" }).click();
  const history = page.getByLabel("补齐批次记录", { exact: true });
  await expect(history).toContainText("原件页 3、7 · 已应用");
  await expect(history).toContainText("原件页 12 · 待审批");
  await history.getByRole("button", { name: "恢复此批原件页" }).last().click();
  await expect(page.getByLabel("原件页（最多 10 页）")).toHaveValue("12");
  expect(writes).toHaveLength(0); expect(reads).toHaveLength(0);
  await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toHaveCount(0);
  await page.getByRole("button", { name: "预览履约补齐" }).click();
  await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toBeVisible(); expect(reads[0].pages).toBe("12");
  state.historyDenied = true; await page.getByRole("button", { name: "刷新补齐批次记录" }).click();
  await expect(page.getByRole("alert")).toHaveText("批次范围已撤销"); await expect(history).toHaveCount(0);
  await expect(page.getByRole("button", { name: "提交履约补齐审批" })).toHaveCount(0);
});

test("workspace changes discard delayed history and task changes clear it", async ({ page }) => {
  const { state, writes } = await setup(page); state.historyDelayed = true;
  await page.getByRole("button", { name: "刷新补齐批次记录" }).click(); await expect(page.getByText("正在处理…")).toBeVisible();
  await page.getByRole("button", { name: "切换工作区" }).click(); state.release();
  await expect(page.getByLabel("补齐批次记录", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "刷新补齐批次记录" }).click();
  await expect(page.getByLabel("补齐批次记录", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "切换任务" }).click();
  await expect(page.getByLabel("补齐批次记录", { exact: true })).toHaveCount(0); expect(writes).toHaveLength(0);
});
