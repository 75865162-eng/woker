import { build } from "esbuild";
import { test, expect } from "@playwright/test";
let bundle = "";
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { FinanceWorkbench } from "./src/components/operations/finance-workbench"; createRoot(document.getElementById("root")).render(<FinanceWorkbench getHeaders={() => new Headers({"x-workspace-id":"fixture-workspace"})} />);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
});
test("finance browser preserves decimal strings, UTC, classification and pagination", async ({ page }) => {
  const requests: URL[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43226");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      requests.push(url); expect(url.searchParams.get("section")).toBe("finance");
      return route.fulfill({ json: { rows: [{ transactionId: url.searchParams.get("page") === "2" ? "fixture-tx-2" : "fixture-tx-1", sourceRunId: "fixture-source-run", marketplaceId: "fixture-site-b", postedAt: "2026-11-01T01:00:00Z", transactionType: null, rawStatus: null, orderId: null, classification: "NON_ORDER", originalAmount: "9007199254740993.123456789012345678901234567890", currency: "EUR", convertedAmount: null, convertedCurrency: null, conversionStatus: "UNCONVERTED", marketplaceTimeZone: "UTC" }], pagination: { total: 51, pageCount: 2 }, quarantinedCount: 1, unconvertedCount: 51, sources: [] } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43226");
  await expect(page.getByRole("cell", { name: "9007199254740993.123456789012345678901234567890 EUR", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "2026-11-01T01:00:00.000Z", exact: true })).toBeVisible();
  await expect(page.getByText(/待归属隔离 1 条/)).toBeVisible();
  await page.getByRole("button", { name: "财务下一页" }).click();
  await expect(page.getByRole("cell", { name: /^fixture-tx-2/ })).toBeVisible();
  await page.getByLabel("币种", { exact: true }).fill("EUR");
  await expect.poll(() => requests.at(-1)?.searchParams.get("currency")).toBe("EUR");
  expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
  await expect(page.getByRole("cell", { name: "fixture-source-run", exact: true })).toBeVisible();
  await page.getByLabel("入账从（UTC）", { exact: true }).fill("2025-07-04");
  await expect.poll(() => requests.at(-1)?.searchParams.get("from")).toBe("2025-07-04");
  await page.getByRole("button", { name: "财务下一页" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");
  await page.getByLabel("来源批次", { exact: true }).fill("fixture-source-run");
  await expect.poll(() => requests.at(-1)?.searchParams.get("sourceRunId")).toBe("fixture-source-run");
  expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
  await page.getByLabel("时间范围", { exact: true }).selectOption("exact");
  await page.getByLabel("入账起点（UTC，含）", { exact: true }).fill("2025-07-04T09:31:07.189Z");
  await page.getByLabel("入账终点（UTC，不含）", { exact: true }).fill("2025-08-03T09:31:07.189Z");
  await expect.poll(() => requests.at(-1)?.searchParams.get("toTimestamp")).toBe("2025-08-03T09:31:07.189Z");
  expect(requests.at(-1)?.searchParams.get("fromTimestamp")).toBe("2025-07-04T09:31:07.189Z");
  expect(requests.at(-1)?.searchParams.has("from")).toBe(false);
  expect(requests.at(-1)?.searchParams.has("to")).toBe(false);
  await page.getByRole("button", { name: "财务下一页" }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");
  expect(requests.at(-1)?.searchParams.get("sourceRunId")).toBe("fixture-source-run");
  expect(requests.at(-1)?.searchParams.get("fromTimestamp")).toBe("2025-07-04T09:31:07.189Z");
  await page.getByLabel("时间范围", { exact: true }).selectOption("day");
  await expect.poll(() => requests.at(-1)?.searchParams.get("from")).toBe("2025-07-04");
  expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
  expect(requests.at(-1)?.searchParams.has("fromTimestamp")).toBe(false);
  expect(requests.at(-1)?.searchParams.has("toTimestamp")).toBe(false);
});
test("finance browser hides facts on denied access and recovers empty state", async ({ page }) => {
  let denied = true;
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43226");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") return denied ? route.fulfill({ status: 403, json: { error: "fixture finance scope denied" } }) : route.fulfill({ json: { rows: [], sources: [], pagination: { total: 0, pageCount: 0 }, quarantinedCount: 0, unconvertedCount: 0 } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43226"); await expect(page.getByRole("alert")).toHaveText("fixture finance scope denied");
  await expect(page.getByRole("table")).toHaveCount(0);
  denied = false; await page.getByRole("button", { name: "刷新财务" }).click();
  await expect(page.getByText(/当前范围没有已归属的财务交易/)).toBeVisible();
});
