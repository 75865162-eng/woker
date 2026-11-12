import { build } from "esbuild";
import { expect, test } from "@playwright/test";
let bundle = "";
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: `import React, { useState } from 'react'; import { createRoot } from 'react-dom/client'; import { ActualFieldCoveragePanel } from './src/components/operations/actual-field-coverage-panel'; const headers = () => new Headers(); function Fixture() { const [source, setSource] = useState('source-a'); return <><button onClick={() => setSource('source-b')}>切换来源</button><ActualFieldCoveragePanel key={source} sourceId={source} requestHeaders={headers}/></>; } createRoot(document.getElementById('root')).render(<Fixture/>);`, loader: "tsx", resolveDir: process.cwd() }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
});
const report = (count: number) => ({ archives: { reportPayloads: 2, withFieldObservations: 1 }, fields: { observed: 24, mapped: 2, unmapped: 22 },
  business: { storedRows: count, publishedRows: count, rowsWithAmountMissingCurrency: 3, firstObservedBusinessDate: "2026-10-10", lastObservedBusinessDate: "2026-11-08" },
  query: { visibleRows: count }, persistence: { fieldsWithPassedBatch: 2, fieldsWithFailedBatch: 0, evidenceTruncated: false }, settlementReplays: { recent: [], truncated: false } });

test("actual coverage renders separate metrics and clears stale evidence when access is denied", async ({ page }) => {
  let denied = false;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43225"); expect(route.request().method()).toBe("GET");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      expect(url.searchParams.get("section")).toBe("field-coverage");
      return route.fulfill({ status: denied ? 403 : 200, json: denied ? { error: "范围已撤销" } : report(17) });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43225/");
  await expect(page.getByText("有金额但缺币种", { exact: true })).toBeVisible();
  await expect(page.getByText("官方字段总数、全字段验收和真实 API 验收仍未完成", { exact: false })).toBeVisible();
  denied = true; await page.getByRole("button", { name: "刷新实际覆盖" }).click();
  await expect(page.getByRole("alert")).toHaveText("范围已撤销");
  await expect(page.getByText("已保存业务行", { exact: true })).toHaveCount(0);
});

test("source switch discards a delayed coverage response", async ({ page }) => {
  let release: () => void = () => {};
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      if (url.searchParams.get("sourceId") === "source-a") { await delayed; await route.fulfill({ json: report(999) }).catch(() => {}); return; }
      return route.fulfill({ json: report(7) });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43225/");
  await expect(page.getByRole("status")).toBeVisible();
  await page.getByRole("button", { name: "切换来源" }).click();
  await expect(page.locator("div").filter({ has: page.getByText("已保存业务行", { exact: true }) }).last()).toContainText("7");
  release(); await expect(page.getByText("999", { exact: true })).toHaveCount(0);
});
