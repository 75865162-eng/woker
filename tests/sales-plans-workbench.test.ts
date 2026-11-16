import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, expect, type Route } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const origin = "http://127.0.0.1:43247";

function plan(id: string, status = "ACTIVE") {
  return {
    plan: { id, name: `真实计划${id}`, marketplace: "DE", currency: "EUR", periodType: "QUARTER", periodStart: "2026-10-01", periodEnd: "2026-12-31", status, revision: 7, forecastWindowDays: 28, seasonalityBp: 12500, notes: `备注${id}` },
    lines: [{ id: `line-${id}`, sellerSku: `SKU-${id}`, asin: `ASIN-${id}`, targetQty: 42, targetRevenue: "1234.56", unitCost: "12.34", historyDailyAvg: "2", forecastQty: 50, actualQty: 3, actualRevenue: 100, completionBp: 714, gap: -39 }],
    totals: { targetQty: 42, actualQty: 3, forecastQty: 50 },
  };
}

test("销售计划真实详情回填、失败和关闭阻断、乱序载入与保存互斥", async () => {
  const bundle = (await build({
    absWorkingDir: root, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {SalesPlansWorkbench} from './src/components/operations/ext/sales-plans-workbench';
      import {AppShellUserProvider} from './src/components/app-shell/app-shell-context';
      createRoot(document.getElementById('root')).render(<AppShellUserProvider value={{organizationId:'fixture-org',userId:'fixture-user',userInitials:'F'}}><SalesPlansWorkbench/></AppShellUserProvider>);
    ` },
  })).outputFiles[0].text;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const pending = new Map<string, Route>();
    const writes: Array<Record<string, unknown>> = [];
    let pendingWrite: Route | undefined;
    const rows = ["A", "B", "FAIL", "CLOSED", "STALE", "EMPTY", "MISMATCH"].map(id => ({ id, name: `列表${id}`, marketplace: "US", periodStart: "2026-01-01", periodEnd: "2026-01-31", status: id === "CLOSED" ? "CLOSED" : "ACTIVE", lineCount: 1, targetQty: 1, targetRevenue: 1, forecastQty: 1, revision: 1 }));
    await page.route("**/*", async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, "测试不得访问真实服务");
      if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
      if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
      assert.equal(url.pathname, "/api/operations/ext");
      if (request.method() === "POST") { writes.push(request.postDataJSON()); pendingWrite = route; return; }
      const kind = url.searchParams.get("kind");
      if (kind === "sales-plan") { pending.set(url.searchParams.get("id")!, route); return; }
      return route.fulfill({ json: kind === "sales-plans" ? { items: rows } : { products: [] } });
    });
    const load = (id: string) => page.getByRole("row").filter({ has: page.getByRole("cell", { name: `列表${id}`, exact: true }) }).getByRole("button", { name: "载入明细" });
    const editor = page.locator("fieldset");
    async function reply(id: string, body = plan(id), status = 200) {
      await expect.poll(() => pending.has(id)).toBe(true);
      const route = pending.get(id);
      assert.ok(route, `应有 ${id} 详情请求`);
      pending.delete(id);
      await route.fulfill({ status, json: body });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    await page.goto(origin);
    await load("A").waitFor();
    await page.getByLabel("计划名称", { exact: true }).fill("别的草稿");
    await editor.locator("tbody input").nth(0).fill("WRONG-SKU");
    await load("A").click();
    await page.waitForFunction(() => document.querySelector('fieldset')?.disabled);
    assert.equal(await page.getByRole("button", { name: "创建计划" }).isDisabled(), true);
    await reply("A");
    await page.getByRole("button", { name: "保存修改" }).waitFor();
    assert.equal(await page.getByLabel("计划名称", { exact: true }).inputValue(), "真实计划A");
    assert.equal(await editor.getByRole("combobox").nth(0).inputValue(), "DE");
    assert.equal(await editor.getByRole("combobox").nth(1).inputValue(), "QUARTER");
    assert.equal(await page.getByLabel("预测窗口（天）", { exact: true }).inputValue(), "28");
    assert.equal(await page.getByLabel("季节系数（bp）").inputValue(), "12500");
    assert.deepEqual(await editor.locator("tbody input").evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)), ["SKU-A", "ASIN-A", "42", "1234.56", "12.34"]);
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect.poll(() => writes.length).toBe(1);
    assert.deepEqual(writes[0], {
      action: "save-sales-plan", id: "A", name: "真实计划A", marketplace: "DE", currency: "EUR", periodType: "QUARTER",
      periodStart: "2026-10-01", periodEnd: "2026-12-31", revision: 7, forecastWindowDays: 28, seasonalityBp: 12500, notes: "备注A",
      lines: [{ sellerSku: "SKU-A", asin: "ASIN-A", targetQty: 42, targetRevenue: 1234.56, unitCost: 12.34 }],
    });
    assert.equal(await load("B").isDisabled(), true);
    await load("B").evaluate(button => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    assert.equal(pending.has("B"), false);
    assert.ok(pendingWrite);
    await pendingWrite.fulfill({ json: { data: {} } });
    await page.getByRole("button", { name: "创建计划" }).waitFor();

    await load("A").click();
    await load("B").click();
    await reply("B");
    await page.getByRole("button", { name: "保存修改" }).waitFor();
    await reply("A");
    assert.equal(await page.getByLabel("计划名称", { exact: true }).inputValue(), "真实计划B");
    assert.equal(await editor.locator("tbody input").first().inputValue(), "SKU-B");

    await load("FAIL").click();
    await reply("FAIL", { error: "隔离测试读取失败" } as unknown as ReturnType<typeof plan>, 500);
    await page.getByRole("alert").filter({ hasText: "隔离测试读取失败" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "创建计划" }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "保存修改" }).count(), 0);
    assert.equal(writes.length, 1);

    await load("CLOSED").click();
    await page.getByRole("alert").filter({ hasText: "不可编辑" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "创建计划" }).isDisabled(), true);
    await load("STALE").click();
    await reply("STALE", plan("STALE", "CLOSED"));
    await page.getByRole("alert").filter({ hasText: "不可编辑" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "创建计划" }).isDisabled(), true);

    await load("MISMATCH").click();
    await reply("MISMATCH", plan("A"));
    await page.getByRole("alert").filter({ hasText: "不一致" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "创建计划" }).isDisabled(), true);
    await load("EMPTY").click();
    await reply("EMPTY", { ...plan("EMPTY"), lines: [] });
    await page.getByRole("button", { name: "保存修改" }).waitFor();
    assert.equal(await editor.locator("tbody input").count(), 0);
    await page.getByRole("button", { name: "保存修改" }).click();
    await page.getByRole("alert").filter({ hasText: "至少填写一行" }).waitFor();
    assert.equal(writes.length, 1);

    await load("A").click();
    await page.getByRole("button", { name: "退出编辑" }).click();
    await reply("A");
    assert.equal(await page.getByLabel("计划名称", { exact: true }).inputValue(), "");
    assert.equal(await page.getByRole("button", { name: "保存修改" }).count(), 0);
    assert.equal(await editor.locator("tbody input").first().inputValue(), "");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
