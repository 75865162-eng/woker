import { build } from "esbuild";
import { test, expect } from "@playwright/test";

test("Inbound plan and shipment filters reset pagination and retain seller/site scope", async ({ page }) => {
  const bundle = (await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { ObservationsWorkbench } from "./src/components/operations/observations-workbench"; createRoot(document.getElementById("root")).render(<ObservationsWorkbench resource="fulfillment" sellerAccountId="fixture-seller" marketplaceId="fixture-site" getHeaders={() => new Headers()} onTask={() => {}} />);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  const requests: URL[] = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43229");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") {
      requests.push(url); expect(route.request().method()).toBe("GET");
      return route.fulfill({ json: { run: { id: "fixture-published-run", finishedAt: "2026-11-01T00:00:00Z" }, latestTask: { id: "fixture-pending-run", status: "RUNNING", stage: "FETCHING", processedCount: 10, failedCount: 0, updatedAt: "2026-11-02T00:00:00Z", error: null }, source: { id: "source", lastSuccessAt: "2026-11-01T00:00:00Z" }, sources: [], versions: [], rows: [], pagination: { total: 51, pageCount: 2 } } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43229");
  await expect(page.getByText("当前已发布版本没有符合筛选条件的记录，请调整视图或筛选条件。", { exact: true })).toBeVisible();
  await expect(page.getByText(/当前已发布版本：fixture-published-run/)).toBeVisible();
  await expect(page.getByText(/当前来源尚无完整发布版本/)).toHaveCount(0);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("page")).toBe("2");
  await page.getByLabel("入库计划 ID", { exact: true }).fill("plan-fixture");
  await expect.poll(() => requests.at(-1)?.searchParams.get("inboundPlanId")).toBe("plan-fixture");
  expect(requests.at(-1)?.searchParams.get("page")).toBe("1");
  await page.getByLabel("货件 ID", { exact: true }).fill("shipment-fixture");
  await expect.poll(() => requests.at(-1)?.searchParams.get("shipmentId")).toBe("shipment-fixture");
  expect(requests.at(-1)?.searchParams.get("inboundPlanId")).toBe("plan-fixture");
  expect(requests.at(-1)?.searchParams.get("sellerAccountId")).toBe("fixture-seller");
  expect(requests.at(-1)?.searchParams.get("marketplaceId")).toBe("fixture-site");
  await page.getByRole("button", { name: "货件商品", exact: true }).click();
  await expect.poll(() => requests.at(-1)?.searchParams.get("kind")).toBe("INBOUND_SHIPMENT_ITEM");
  expect(requests.at(-1)?.searchParams.get("shipmentId")).toBe("shipment-fixture");
});

test("Catalog partial publication displays its missing ASIN without claiming a complete snapshot", async ({ page }) => {
  const bundle = (await build({ stdin: { contents: 'import React from "react"; import { createRoot } from "react-dom/client"; import { ObservationsWorkbench } from "./src/components/operations/observations-workbench"; createRoot(document.getElementById("root")).render(<ObservationsWorkbench resource="catalog_items" sellerAccountId="fixture-seller" marketplaceId="fixture-site" getHeaders={() => new Headers()} onTask={() => {}} />);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  await page.route("**/*", route => {
    const url = new URL(route.request().url()); expect(url.origin).toBe("http://127.0.0.1:43229");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: bundle });
    if (url.pathname === "/api/operations/sync-center") return route.fulfill({ json: { run: { id: "partial-run", finishedAt: "2026-11-01T00:00:00Z", summary: { coverage: { complete: false, unavailableObjectIds: ["B987654321"] } } }, source: { id: "source", lastSuccessAt: null }, sources: [], versions: [], rows: [{ id: "row", sourceRunId: "partial-run", kind: "CATALOG_DETAIL", asin: "B123456789", facts: { summaries: [{ itemName: "Available catalog item" }] }, capturedAt: "2026-11-01T00:00:00Z" }], pagination: { total: 1, pageCount: 1 } } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43229");
  await expect(page.getByRole("status")).toHaveText(/部分发布.*B987654321.*不代表全量目录/);
  await expect(page.getByRole("cell", { name: "Available catalog item", exact: true })).toBeVisible();
  await expect(page.getByText(/当前已发布版本：partial-run/)).toBeVisible();
});
