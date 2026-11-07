import { build } from "esbuild";
import { test, expect } from "@playwright/test";

let bundle = "";
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { OrdersWorkbench } from "./src/components/operations/orders-workbench"; createRoot(document.getElementById("root")).render(<OrdersWorkbench getHeaders={() => new Headers({"x-workspace-id":"fixture-workspace"})} onTask={id => { document.title = id; }} />);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
});

test("orders browser shows partial coverage, UTC, null states and pagination using local HTTP fixtures", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/api/operations/sync-center") {
      expect(route.request().method()).toBe("GET");
      expect(route.request().headers()["x-workspace-id"]).toBe("fixture-workspace");
      requests.push(url);
      const second = url.searchParams.get("page") === "2";
      return route.fulfill({ json: { rows: [{ amazonOrderId: second ? "fixture-order-2" : "fixture-order-1", sourceId: "fixture-source", sourceRunId: "fixture-task", marketplaceId: "fixture-marketplace", createdTime: "2026-10-31T20:00:00Z", sourceUpdatedAt: "2026-11-01T00:10:00Z", rawStatus: null, normalizedStatus: null, marketplaceTimeZone: "UTC" }], sources: [{ id: "fixture-source", enabled: true, marketplaceId: "fixture-marketplace", seller: { displayName: "Fixture store" }, resourceCursor: { watermarkFrom: "2026-11-01T00:00:00Z", watermarkTo: "2026-11-01T01:00:00Z", lastSuccessAt: null, status: "RUNNING" } }], pagination: { total: 51, pageCount: 2 } } });
    }
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByText("窗口未完成", { exact: true })).toBeVisible();
  await expect(page.getByText("2026-10-31T20:00:00.000Z", { exact: true })).toBeVisible();
  await expect(page.getByText("未映射", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "订单下一页" }).click();
  await expect(page.getByRole("cell", { name: /^fixture-order-2/ })).toBeVisible();
  await page.getByRole("button", { name: "查看来源任务" }).click();
  await expect(page).toHaveTitle("fixture-task");
  expect(requests.some(url => url.searchParams.get("page") === "2")).toBe(true);
});

test("orders browser clears prior facts when access is denied and can reload an empty scope", async ({ page }) => {
  let denied = true;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") return denied ? route.fulfill({ status: 403, json: { error: "fixture permission denied" } }) : route.fulfill({ json: { rows: [], sources: [], pagination: { total: 0, pageCount: 0 } } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByRole("alert")).toHaveText("fixture permission denied");
  await expect(page.getByRole("table")).toHaveCount(0);
  denied = false;
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText(/当前范围没有已落库订单/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("P2 browser distinguishes pending detail and displays exact money without PII", async ({ page }) => {
  let complete = false;
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") return route.fulfill({ json: {
      rows: [{ amazonOrderId: "fixture-order-1", sourceId: "fixture-source", sourceRunId: "fixture-task", marketplaceId: "fixture-marketplace", createdTime: "2026-10-31T20:00:00Z", sourceUpdatedAt: "2026-11-01T00:10:00Z", rawStatus: "UNSHIPPED", normalizedStatus: "ready", marketplaceTimeZone: "UTC", detailsCurrent: complete, grandTotalOriginal: complete ? "9007199254740993.123456789012345678901234567890" : null, currencyCode: complete ? "XXX" : null }],
      sources: [{ id: "fixture-source", enabled: true, detailsEnabled: true, detailsComplete: complete, marketplaceId: "fixture-marketplace", seller: { displayName: "Fixture store" }, resourceCursor: { watermarkFrom: "2026-11-01T00:00:00Z", watermarkTo: "2026-11-01T01:00:00Z", listComplete: true, lastSuccessAt: complete ? "2026-11-05T00:00:00Z" : null, status: complete ? "SUCCEEDED" : "RUNNING" } }], pagination: { total: 1, pageCount: 1 }
    } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByText("列表已完成，详情待补齐", { exact: true })).toBeVisible();
  complete = true;
  await page.getByRole("button", { name: "刷新订单" }).click();
  await expect(page.getByText("详情补齐完成", { exact: true })).toBeVisible();
  await expect(page.getByText("9007199254740993.123456789012345678901234567890 XXX", { exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /^当前版本已补齐/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("fixture-private");
});
