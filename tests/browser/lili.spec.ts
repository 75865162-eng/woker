import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { handleLiliRequest } from "@/lib/lili/api";
import { createRuntimeTools } from "@/lib/lili/runtime-tools";
import { defaultXiyouSettings, mergeXiyouSettings } from "@/lib/lili/tool-config";
import { defaultSellerSpriteMcpSettings, toPublicSellerSpriteMcpSettings } from "@/lib/integrations/sellersprite";

let bundle: string;
let styles: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: ["tests/browser/lili-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: "tsconfig.json",
    plugins: [{ name: "fixture-next", setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({ path: args.path, namespace: "fixture-next" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture-next" }, (args) => ({ loader: "tsx", resolveDir: process.cwd(), contents: args.path === "next/link"
        ? 'export default function Link({href, children, prefetch: _prefetch, ...props}) {return <a href={typeof href === "string" ? href : href.pathname} {...props}>{children}</a>;}'
        : 'export const usePathname=()=>window.location.pathname; export const useRouter=()=>({refresh:()=>window.location.reload()}); export function notFound(){throw new Error("Not found");}' }));
    } }],
  });
  bundle = result.outputFiles[0].text;
  const [{ default: postcss }, { default: tailwind }] = await Promise.all([import("postcss"), import("@tailwindcss/postcss")]);
  const plugin = tailwind() as unknown as import("postcss").AcceptedPlugin;
  styles = (await postcss([plugin]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
  styles += (await readFile("src/components/lili/lili.module.css", "utf8")).replaceAll(".root", ".lili-test-root").replace(/:global\(([^)]+)\)/g, "$1");
});

async function setup(page: Page, path: string) {
  const state = { failNetwork: false, configReadFailure: false, sellerTestFailure: false, sellerProbes: 0, calls: [] as string[], probes: 0 };
  // Isolated protocol doubles: never resolve real credentials or database state in browser tests.
  const runtime = createRuntimeTools([
    { id: "erp", isReadOnly: () => true, transport: {
      async listTools() { return [{ name: "data_query", description: "Isolated inventory query", inputSchema: { type: "object", properties: { table: { type: "string", enum: ["inventory"] } }, required: ["table"], additionalProperties: false }, annotations: { readOnlyHint: true } }]; },
      async callTool(_name, args) { return { source: "isolated-browser-fixture", table: args.table }; },
    } },
    { id: "sellersprite", isReadOnly: () => true, transport: {
      async listTools() { return [{ name: "asin.detail", inputSchema: { type: "object", properties: {} } }]; },
      async callTool() { throw new Error("Paid calls must not run in the tool panel"); },
    } },
    { id: "xiyou", isReadOnly: () => false, reason: "ISOLATED_PROVIDER_NOT_CONNECTED" },
  ]);
  let xiyou = { ...defaultXiyouSettings };
  let sellerSprite = { ...defaultSellerSpriteMcpSettings };
  await page.route("**/*", async (route) => {
    const req = route.request(); const url = new URL(req.url());
    expect(url.origin).toBe("http://127.0.0.1:43239");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (url.pathname === "/style.css") return route.fulfill({ contentType: "text/css", body: styles });
    if (url.pathname === "/api/integrations/sellersprite") {
      if (req.method() === "PUT") {
        const patch = req.postDataJSON().settings;
        sellerSprite = { ...sellerSprite, ...patch, apiKey: patch.apiKey || sellerSprite.apiKey };
      }
      if (req.method() === "POST") {
        state.sellerProbes++;
        return state.sellerTestFailure
          ? route.fulfill({ status: 502, json: { ok: false, message: "SellerSprite MCP 连接失败，请检查已保存配置、网络及服务状态。" } })
          : route.fulfill({ json: { ok: true, message: "SellerSprite MCP 连接成功，已读取 2 个工具；未调用业务工具。" } });
      }
      return route.fulfill({ json: { settings: toPublicSellerSpriteMcpSettings(sellerSprite) } });
    }
    if (url.pathname.startsWith("/api/lili/")) {
      state.calls.push(url.pathname);
      if (state.failNetwork) return route.abort("failed");
      if (state.configReadFailure && req.method() === "GET" && url.pathname.endsWith("/tool-config")) return route.fulfill({ status: 503, json: { message: "配置读取失败，请重试。" } });
      const request = new Request(url, { method: req.method(), headers: req.headers(), ...(req.postData() ? { body: req.postData() } : {}) });
      const response = await handleLiliRequest(request, url.pathname.slice("/api/lili/".length).split("/"), async () => ({ ok: true, user: { id: "fixture-user", organizationId: "fixture-org" } }), {
        store: { async read() { return xiyou; }, async save(_scope, patch) { xiyou = mergeXiyouSettings(patch, xiyou); return xiyou; } },
        async probe() { state.probes++; },
      }, runtime);
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: '<html><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
  });
  await page.goto(`http://127.0.0.1:43239${path}`);
  return state;
}

test("native directory navigation, search and skill details work without an upstream server", async ({ page }) => {
  await setup(page, "/lili");
  await expect(page.getByRole("heading", { name: "粒粒 Lili · 运营技能中心" })).toBeVisible();
  await page.getByRole("link", { name: "技能", exact: true }).click();
  await page.getByPlaceholder("搜索技能").fill("acos-reduction-plan");
  await expect(page.getByRole("heading", { name: "ACOS 压降计划" })).toBeVisible();
  await page.getByRole("button", { name: /展开/ }).click();
  await page.getByRole("link", { name: "完整技能说明" }).click();
  await expect(page.getByRole("heading", { name: "完整技能说明" })).toBeVisible();
  await expect(page.locator("article pre")).toContainText("ACOS");
  await expect(page.getByRole("link", { name: "ads_prepare_changes", exact: true })).toBeVisible();
});

test("tool input validation, catalog result, and network retry keep controls usable", async ({ page }) => {
  const state = await setup(page, "/lili/v2/tools/meta_search_skills");
  await page.getByLabel(/query/).fill("ACOS");
  await page.getByRole("button", { name: "运行工具" }).click();
  await expect(page.getByRole("status")).toContainText("shipped-definitions");
  expect(state.calls).toEqual(["/api/lili/tools/run"]);
  state.failNetwork = true;
  await page.getByRole("button", { name: "运行工具" }).click();
  await expect(page.getByRole("status")).toContainText("请求失败");
  await expect(page.getByRole("button", { name: "运行工具" })).toBeEnabled();
  state.failNetwork = false;
  await page.getByRole("button", { name: "运行工具" }).click();
  await expect(page.getByRole("status")).toContainText("shipped-definitions");
});

test("runtime panel discovers schemas, dispatches read tools, routes paid calls to review and clears scope", async ({ page }) => {
  await setup(page, "/lili/v2/tools");
  await page.getByRole("button", { name: "发现真实工具", exact: true }).click();
  await expect(page.getByText(/erp：connected.*1 个工具/)).toBeVisible();
  const picker = page.getByLabel("选择在线工具");
  await picker.selectOption("erp__data_query");
  await page.getByText("真实参数 Schema", { exact: true }).click();
  await expect(page.locator("details pre").first()).toContainText('"required"');
  await page.getByLabel("工具参数 JSON").fill('{"table":"inventory"}');
  await page.getByRole("button", { name: "执行授权只读查询", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("isolated-browser-fixture");
  await picker.selectOption("sellersprite__asin.detail");
  await expect(page.getByRole("button", { name: "执行授权只读查询", exact: true })).toBeDisabled();
  await expect(page.getByRole("link", { name: "进入 ASIN 选品研究、人工审批与历史报告", exact: true })).toHaveAttribute("href", "/agents/selection-research");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")));
  await expect(picker).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("workflow detail retains source gaps and refuses automatic execution explicitly", async ({ page }) => {
  await setup(page, "/lili/v2/workflows/competitor-teardown");
  await expect(page.getByText("amazon-price-tracker：原始源码包未附此技能定义。")).toBeVisible();
  await expect(page.locator('a[href$="/amazon-price-tracker"]')).toHaveCount(0);
  await page.getByRole("button", { name: "检查工作流执行能力" }).click();
  await expect(page.getByText(/此独立 Lili 操作未映射/)).toBeVisible();
});

test("start page and navigation omit removed entries", async ({ page }) => {
  await setup(page, "/lili");
  await expect(page.getByRole("heading", { name: "粒粒 Lili · 运营技能中心" })).toBeVisible();
  for (const name of ["课程", "团队", "设置", "帮助"]) {
    await expect(page.getByRole("navigation", { name: "Lili 模块" }).getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("link", { name: "工具配置", exact: true })).toBeVisible();
  await expect(page.locator('a[href*="/courses"]')).toHaveCount(0);
  await expect(page.locator("#root")).not.toContainText("课程");
});

test("tool configuration restores both providers, masks secrets after save and preserves them on reload", async ({ page }) => {
  const state = await setup(page, "/lili/v2/tools");
  await page.getByRole("link", { name: "工具配置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "工具配置", exact: true })).toBeVisible();
  const seller = page.getByRole("region", { name: "卖家精灵 SellerSprite", exact: true });
  await expect(seller.getByRole("button", { name: "测试已保存连接" })).toBeDisabled();
  await seller.getByLabel("SellerSprite MCP URL").fill("https://mcp.sellersprite.com/mcp");
  await seller.getByLabel("SellerSprite secret-key").fill("fixture-seller-secret");
  await seller.getByRole("button", { name: "保存卖家精灵配置" }).click();
  await expect(seller.getByRole("status")).toContainText("已保存卖家精灵配置");
  await expect(seller.getByLabel("SellerSprite secret-key")).toHaveValue("");
  const sellerTest = seller.getByRole("button", { name: "测试已保存连接" });
  await expect(sellerTest).toBeEnabled();
  await seller.getByLabel("站点").fill("CA");
  await expect(sellerTest).toBeEnabled();
  await sellerTest.click();
  await expect(seller.getByRole("status")).toContainText("连接成功");
  expect(state.sellerProbes).toBe(1);
  state.sellerTestFailure = true;
  await sellerTest.click();
  await expect(seller.getByRole("status")).toContainText("连接失败");
  expect(state.sellerProbes).toBe(2);
  const card = page.getByRole("region", { name: "西柚洞察", exact: true });
  await card.getByLabel("MCP Token", { exact: true }).fill("fixture-xiyou-browser-token");
  await card.getByLabel("启用西柚 MCP").check();
  await expect(card.getByRole("button", { name: "测试已保存连接" })).toBeDisabled();
  await card.getByRole("button", { name: "保存西柚配置" }).click();
  await expect(card.getByRole("status")).toContainText("已保存西柚配置");
  await expect(card.getByLabel("MCP Token", { exact: true })).toHaveValue("");
  expect(state.probes).toBe(0);
  await page.reload();
  await expect(card.getByLabel("MCP Token", { exact: true })).toHaveAttribute("placeholder", /已保存/);
  await card.getByRole("button", { name: "保存西柚配置" }).click();
  await expect(card.getByRole("status")).toContainText("已保存西柚配置");
  await card.getByRole("button", { name: "测试已保存连接" }).click();
  await expect(card.getByRole("status")).toContainText("西柚 MCP 初始化已响应");
  expect(state.probes).toBe(1);
  await expect(page.locator("body")).not.toContainText("fixture-xiyou-browser-token");
});

test("configuration read and save failures remain visible and allow retry", async ({ page }) => {
  const state = await setup(page, "/lili/v2/tool-config");
  const card = page.getByRole("region", { name: "西柚洞察", exact: true });
  await expect(card.getByRole("button", { name: "保存西柚配置" })).toBeEnabled();
  state.failNetwork = true;
  await card.getByRole("button", { name: "保存西柚配置" }).click();
  await expect(card.getByRole("status")).not.toBeEmpty();
  await expect(card.getByRole("button", { name: "保存西柚配置" })).toBeEnabled();
  state.failNetwork = false; state.configReadFailure = true;
  await page.reload();
  await expect(card.getByRole("status")).toContainText("配置读取失败");
  await expect(card.getByRole("button", { name: "保存西柚配置" })).toBeDisabled();
  state.configReadFailure = false;
  await card.getByRole("button", { name: "重新读取配置" }).click();
  await expect(card.getByRole("button", { name: "保存西柚配置" })).toBeEnabled();
});

test("Lili configuration follows Product Center typography and controls at desktop and mobile widths", async ({ page }) => {
  await setup(page, "/lili/v2/tool-config");
  const seller = page.getByRole("region", { name: "卖家精灵 SellerSprite", exact: true });
  const field = seller.getByLabel("SellerSprite MCP URL");
  const save = seller.getByRole("button", { name: "保存卖家精灵配置" });
  await expect(save).toBeEnabled();
  await expect(save).toHaveCSS("background-color", "rgb(23, 107, 135)");
  await expect(save).toHaveCSS("font-size", "14px");
  await expect(field).toHaveCSS("height", "40px");
  await expect(field).toHaveCSS("border-radius", "6px");
  await expect(seller).toHaveCSS("border-color", "rgb(217, 224, 231)");
  await expect(seller.getByRole("heading")).toHaveCSS("font-size", "16px");
  await expect(page.getByRole("link", { name: "工具配置", exact: true })).toHaveCSS("color", "rgb(23, 107, 135)");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "tmp/lili-config-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await seller.getByText("高级 MCP 配置", { exact: true }).click();
  await expect(seller.getByLabel("超时（秒）")).toBeVisible();
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "tmp/lili-config-mobile.png", fullPage: true });
});
