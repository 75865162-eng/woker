import { build } from "esbuild";
import { test, expect } from "@playwright/test";
let bundle = "";
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { ReturnsWorkbench } from "./src/components/operations/returns-workbench"; createRoot(document.getElementById("root")).render(<ReturnsWorkbench getHeaders={() => new Headers({"x-workspace-id":"fixture-workspace"})} />);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
});
const result = { rows: [{ id: "fixture-row", amazonOrderId: "fixture-order", asin: "fixture-asin", sellerSku: "fixture sku", returnAt: "2026-11-01T01:00:00Z", quantity: 2, disposition: "SELLABLE", rawStatus: null, marketplaceTimeZone: "UTC", reason: { code: "FUTURE_REASON" }, orderMatched: false }], sources: [{ id: "fixture-source", marketplaceId: "fixture-site", seller: { displayName: "Fixture store" }, latestReportId: "fixture-report" }], selectedSourceId: "fixture-source", reportId: "fixture-report", completeness: "SINGLE_PUBLISHED_REPORT", pagination: { total: 51, pageCount: 2 } };
test("returns browser fixes pagination to one published report and renders UTC and unmapped codes", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43227");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      requests.push(url); expect(url.searchParams.get("section")).toBe("returns");
      return route.fulfill({ json: { ...result, rows: [{ ...result.rows[0], amazonOrderId: url.searchParams.get("page") === "2" ? "fixture-order-2" : "fixture-order" }] } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43227");
  await expect(page.getByText(/当前报告：fixture-report/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026-11-01T01:00:00.000Z", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: /FUTURE_REASON.*未返回/ })).toBeVisible();
  await page.getByRole("button", { name: "退货下一页" }).click();
  await expect(page.getByRole("cell", { name: /^fixture-order-2/ })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("reportId")).toBe("fixture-report");
  expect(requests.at(-1)?.searchParams.get("sourceId")).toBe("fixture-source");
  await page.getByLabel("原始原因", { exact: true }).fill("FUTURE_REASON");
  await expect.poll(() => requests.at(-1)?.searchParams.get("reason")).toBe("FUTURE_REASON");
  expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
});
test("returns browser clears previously visible facts on denied access and handles an empty report", async ({ page }) => {
  let mode = "facts";
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43227");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") return mode === "denied" ? route.fulfill({ status: 403, json: { error: "fixture returns scope denied" } }) : route.fulfill({ json: mode === "facts" ? result : { ...result, rows: [], pagination: { total: 0, pageCount: 0 } } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43227"); await expect(page.getByRole("cell", { name: /^fixture-order/ })).toBeVisible();
  mode = "denied"; await page.getByRole("button", { name: "刷新退货" }).click();
  await expect(page.getByRole("alert")).toHaveText("fixture returns scope denied"); await expect(page.getByRole("table")).toHaveCount(0);
  mode = "empty"; await page.getByRole("button", { name: "刷新退货" }).click();
  await expect(page.getByText("本报告当前筛选无退货明细。")).toBeVisible();
});
