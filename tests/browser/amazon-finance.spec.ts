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
      return route.fulfill({ json: { rows: [{ transactionId: url.searchParams.get("page") === "2" ? "fixture-tx-2" : "fixture-tx-1", marketplaceId: "fixture-site-b", postedAt: "2026-11-01T01:00:00Z", transactionType: null, rawStatus: null, orderId: null, classification: "NON_ORDER", originalAmount: "9007199254740993.123456789012345678901234567890", currency: "EUR", convertedAmount: null, convertedCurrency: null, conversionStatus: "UNCONVERTED", marketplaceTimeZone: "UTC" }], pagination: { total: 51, pageCount: 2 }, quarantinedCount: 1, unconvertedCount: 51, sources: [] } });
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
