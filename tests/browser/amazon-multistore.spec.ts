import { build } from "esbuild";
import { expect, test } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
let bundle = "", styles = "";
const screenshotDir = "docs/wimoor-integration/ui/screenshots";
const mcpToolTuples = [["amazon.inventory.list", "查询库存"], ["amazon.ads.entities.list", "只读分页查询已同步的 SP 广告结构"], ["amazon.ads.reports.list", "只读查询本地最新已发布广告日报；需要独立显式授权"]] as const;
const mcpToolCatalog = mcpToolTuples.map(([name, description]) => ({ name, description, module: name.startsWith("amazon.ads.") ? "amazon_ads" : "amazon_sync", version: "1.1.0", inputSchema: { type: "object", properties: {} }, outputSchema: { type: "object" }, operationMode: "READ_ONLY", requiredPermissions: ["operations:view", "amazon_data:view:mcp"], enabled: true, implementationStatus: "IMPLEMENTED" }));
test.beforeAll(async () => {
  bundle = (await build({ stdin: { contents: 'import React from "react"; import {createRoot} from "react-dom/client"; import {SkillErpSettingsPanel} from "./src/components/settings/skill-erp-settings-panel"; import {AmazonStoresPanel} from "./src/components/operations/amazon-stores-panel"; createRoot(document.getElementById("root")!).render(<><SkillErpSettingsPanel/><AmazonStoresPanel canEdit={true}/></>);', resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  const [{ default: postcss }, { default: tailwind }] = await Promise.all([import("postcss"), import("@tailwindcss/postcss")]);
  styles = (await postcss([tailwind() as unknown as import("postcss").AcceptedPlugin]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
  await mkdir(screenshotDir, { recursive: true });
});
test("personal MCP credential lifecycle is reachable; plaintext clears on workspace change", async ({ page }) => {
  const commands: Record<string, unknown>[] = [];
  let credential: Record<string, unknown> | undefined;
  await page.route("**/*", async route => {
    const r = route.request(), url = new URL(r.url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/api/operations/amazon-stores") return route.fulfill({ json: { stores: [] } });
    if (url.pathname === "/api/operations/amazon-mcp") {
      if (r.method() === "POST") { const body = r.postDataJSON(); commands.push(body); credential = { id: "credential", name: "我的 Amazon MCP", status: body.action === "disable" ? "DISABLED" : "ACTIVE", revision: commands.length, tokenPrefix: "amcp_fixture", expiresAt: "2026-12-01T00:00:00Z", lastUsedAt: null, tools: ["amazon.inventory.list"], scopes: [{ sellerAccountId: "seller-a", marketplaceIds: ["US"] }] }; return route.fulfill({ json: { credential, ...(body.action === "disable" ? {} : { token: `fixture-once-${commands.length}` }) } }); }
      return route.fulfill({ json: { credentials: credential ? [credential] : [], scopes: [{ sellerAccountId: "seller-a", marketplaceId: "US", displayName: "店铺 A" }], tools: mcpToolTuples, toolCatalog: mcpToolCatalog, tables: [
        { name: "inventory", source: "AmazonInventorySnapshot", grain: ["sellerAccountId", "marketplaceId", "sellerSku"], schemaStatus: "application_schema_confirmed_source_sample_pending", available: true, sourceCount: 1, rowCount: 24, lastSyncAt: "2026-11-06T00:00:00Z", freshness: "ok", warnings: [] },
        { name: "ads_report_daily", source: "AmazonAdsReportFact", grain: ["sellerAccountId", "marketplaceId", "reportDate", "factKey", "versionId"], schemaStatus: "application_schema_confirmed_source_sample_pending", available: true, sourceCount: 1, rowCount: null, lastSyncAt: "2026-11-06T00:00:00Z", freshness: "ok", warnings: ["版本行数尚未汇总"] },
      ], status: { ads: { connectionStatus: "NOT_CONNECTED", oauthConfigured: false, syncEnabled: false, structureAdapterReady: false, reportAdapterReady: false, profileCount: 0, connectedProfileCount: 0, schemaStatus: "UNAVAILABLE", dataIntegrity: "UNAVAILABLE", freshness: "missing", lastPublishedAt: null, profiles: [], freshnessStates: [] }, publishedVersions: [], callLogs: [{ id: "audit-1", status: "DENIED", createdAt: "2026-11-06T00:00:00Z", requestId: "request-fixture", tool: "amazon.inventory.list", toolVersion: "1.1.0", gatewayStatus: "FAILED", failureClass: "SCHEMA_VALIDATION", durationMs: 12, reason: "INVALID_INPUT" }], callLogPagination: { page: 1, pageSize: 20, pageCount: 1, total: 1, hasMore: false } } } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByRole("heading", { name: "当前 ERP 数据可用性" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前 MCP 工具目录" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "amazon.ads.entities.list" })).toContainText("只读分页查询已同步的 SP 广告结构");
  await expect(page.getByRole("row").filter({ hasText: "amazon.ads.reports.list" })).toContainText("需要独立显式授权");
  const auditRow = page.getByRole("row").filter({ hasText: "request-fixture" });
  await expect(auditRow).toContainText("v1.1.0");
  await expect(auditRow).toContainText("12 ms");
  await expect(auditRow).toContainText("SCHEMA_VALIDATION");
  await expect(page.getByRole("checkbox", { name: "只读查询本地最新已发布广告日报；需要独立显式授权" })).toBeEnabled();
  await expect(page.getByText("1 个来源 / 24 行")).toBeVisible();
  await expect(page.getByText("1 个来源 / 版本行数未汇总")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "ads_report_daily" }).getByText("来源样本待核验 · 新鲜")).toBeVisible();
  await page.getByRole("checkbox", { name: "店铺 A / US" }).check(); await page.getByRole("checkbox", { name: "查询库存" }).check();
  await page.getByRole("button", { name: "创建个人凭证" }).click();
  await expect(page.getByLabel("新 MCP 密钥")).toHaveValue("fixture-once-1");
  expect(commands[0]).toMatchObject({ action: "create", tools: ["amazon.inventory.list"], scopes: [{ sellerAccountId: "seller-a", marketplaceIds: ["US"] }] });
  await page.getByRole("button", { name: "已保存，关闭展示" }).click(); await expect(page.getByLabel("新 MCP 密钥")).toHaveCount(0);
  await page.getByRole("button", { name: "轮换", exact: true }).click(); await expect(page.getByLabel("新 MCP 密钥")).toHaveValue("fixture-once-2");
  // The actual app event is dispatched by the workspace selector.
  await page.evaluate(() => { localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "second" })); window.dispatchEvent(new Event("amazon-bulk-ad:workspace-scope-changed")); });
  await expect(page.getByLabel("新 MCP 密钥")).toHaveCount(0);
  await page.getByRole("button", { name: "禁用", exact: true }).click(); await expect(page.getByRole("button", { name: "轮换", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => Object.values(localStorage).join(" "))).not.toContain("fixture-once");
});
test("Skill ERP settings displays an explicit empty MCP tool catalog", async ({ page }) => {
  await page.route("**/*", async route => {
    const r = route.request(), url = new URL(r.url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/api/operations/amazon-mcp") return route.fulfill({ json: { credentials: [], scopes: [], tools: [], toolCatalog: [], tables: [] } });
    if (url.pathname === "/api/operations/amazon-stores") return route.fulfill({ json: { stores: [] } });
    return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByText("当前没有可授权的 MCP 工具。", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});
test("Lili research grants require explicit selection and preserve existing seller scope", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/api/operations/amazon-stores") return route.fulfill({ json: { stores: [] } });
    if (url.pathname === "/api/operations/amazon-mcp") {
      if (request.method() === "POST") { submitted = request.postDataJSON(); return route.fulfill({ json: { credential: { id: "fixture-only" } } }); }
      return route.fulfill({ json: { credentials: [], scopes: [{ sellerAccountId: "seller-a", marketplaceId: "US", displayName: "店铺 A" }], tools: mcpToolTuples, toolCatalog: mcpToolCatalog, tables: [] } });
    }
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43225");
  const read = page.getByRole("checkbox", { name: "Lili 开品：读取本人研究" });
  const start = page.getByRole("checkbox", { name: "Lili 开品：创建研究（真实调用仍需审批）" });
  await expect(read).not.toBeChecked(); await expect(start).not.toBeChecked();
  await expect(page.getByRole("button", { name: "创建个人凭证" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "店铺 A / US" }).check();
  await read.check();
  await page.getByRole("button", { name: "创建个人凭证" }).click();
  await expect.poll(() => submitted?.tools).toEqual(["research_read"]);
  expect(submitted?.scopes).toEqual([{ sellerAccountId: "seller-a", marketplaceIds: ["US"] }]);
  expect(await page.evaluate(() => Object.values(localStorage).join(" "))).not.toContain("research_read");
});
test("Skill ERP settings rejects an invalid MCP tool catalog without stale fallback", async ({ page }) => {
  await page.route("**/*", async route => {
    const r = route.request(), url = new URL(r.url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname === "/api/operations/amazon-mcp") return route.fulfill({ json: { credentials: [], scopes: [{ sellerAccountId: "seller-a", marketplaceId: "US", displayName: "店铺 A" }], tools: null, toolCatalog: mcpToolCatalog, tables: [] } });
    if (url.pathname === "/api/operations/amazon-stores") return route.fulfill({ json: { stores: [] } });
    if (url.pathname === "/api/lili/devices") return route.fulfill({ json: { devices: [] } });
    return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByRole("alert")).toHaveText("MCP 工具目录格式无效。");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
});
test("store details support name edits without submitting identity changes", async ({ page }) => {
  let name = "自定义店铺", submitted: Record<string, unknown> = {};
  await page.route("**/*", async route => {
    const r = route.request(), url = new URL(r.url()); expect(url.origin).toBe("http://127.0.0.1:43225");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname === "/api/operations/amazon-mcp") return route.fulfill({ json: { credentials: [], scopes: [], tools: [], toolCatalog: [], tables: [] } });
    if (url.pathname === "/api/operations/amazon-stores") {
      if (r.method() === "PATCH") { submitted = r.postDataJSON(); name = String(submitted.displayName); return route.fulfill({ json: { saved: true } }); }
      return route.fulfill({ json: { stores: [{ id: "seller", displayName: name, status: "active", updatedAt: "2026-11-05T00:00:00Z", identities: [{ id: "identity-us", amazonSellerId: "REALID", marketplaceId: "US", region: "us-east-1", authorizationId: "auth", verifiedAt: "2026-11-05T00:00:00Z" }, { id: "identity-ca", amazonSellerId: "REALID", marketplaceId: "CA", region: "us-east-1", authorizationId: "auth", verifiedAt: "2026-11-05T00:00:00Z" }], authorizations: [{ id: "auth", amazonSellerId: "REALID", awsRegion: "us-east-1", status: "CONFIGURED", identityVerifiedAt: "2026-11-05T00:00:00Z", authorizedByUserId: "owner", createdAt: "2026-11-05T00:00:00Z" }], sources: [], operators: [{ userId: "a", name: "运营 A", role: "operations" }], grants: [], roleGrants: [] }] } });
    }
    return route.fulfill({ contentType: "text/html", body: '<html><head><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto("http://127.0.0.1:43225");
  await expect(page.getByRole("columnheader", { name: "SP-API 授权" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "REALID" })).toHaveCount(2);
  await page.getByLabel("Marketplace 筛选").selectOption("US");
  const storeRow = page.getByRole("row").filter({ hasText: "REALID" });
  await expect(storeRow).toContainText("身份已验证");
  await expect(storeRow).toContainText("US");
  await page.getByLabel("授权状态筛选").selectOption("CONFIGURED");
  await expect(storeRow).toHaveCount(1);
  await page.locator('[aria-label="Amazon 店铺与站点授权"]').screenshot({ path: `${screenshotDir}/amazon-store-sites-fixture.png` });
  await expect(storeRow).toContainText("店铺详情 / 管理");
  await storeRow.getByText("店铺详情 / 管理").click();
  await page.getByLabel("ERP 店铺显示名称").fill("改名后"); await page.getByRole("button", { name: "保存显示名称" }).click();
  await expect(page.getByRole("row").filter({ hasText: "REALID" })).toContainText("改名后");
  expect(Object.keys(submitted).sort()).toEqual(["displayName", "id", "updatedAt"]);
  await page.getByLabel("Marketplace 筛选").selectOption(""); await page.getByLabel("授权状态筛选").selectOption("");
  await page.getByLabel("搜索店铺名称或 Seller ID").fill("不存在"); await expect(page.getByText("暂无符合条件的店铺或站点。", { exact: true })).toBeVisible();
});
