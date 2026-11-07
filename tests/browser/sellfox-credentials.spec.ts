import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";

let bundle: string;
let styles: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: ["tests/browser/sellfox-credentials-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  bundle = result.outputFiles[0].text;
  const [{ readFile }, { default: postcss }, { default: tailwind }] = await Promise.all([import("node:fs/promises"), import("postcss"), import("@tailwindcss/postcss")]);
  styles = (await postcss([tailwind()]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
});

async function setup(page: Page, options: { canEdit?: boolean; ready?: boolean; fail?: boolean; delayed?: boolean; configured?: boolean; testFailure?: boolean } = {}) {
  const calls: { method: string; scope: string; body: Record<string, unknown> | null }[] = [];
  const state = { release: () => {}, pending: false };
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/integrations/sellfox/credentials/test") {
      calls.push({ method: request.method(), scope: request.headers()["x-workspace-id"], body: null });
      expect(request.headers()["x-credential-revision"]).toBe("0");
      if (options.delayed) { state.pending = true; await new Promise<void>(resolve => { state.release = resolve; }); }
      return route.fulfill({ json: { passed: !options.testFailure, message: options.testFailure ? "赛狐接口调用失败（HTTP 200 / 40005，访问的客户端 IP 不在白名单）。" : "连接成功，赛狐已接受当前凭据并返回有效 Token。尚未验证店铺或各业务接口权限。" } }).catch(() => undefined);
    }
    if (url.pathname === "/api/integrations/sellfox/credentials") {
      const scope = request.headers()["x-workspace-id"];
      calls.push({ method: request.method(), scope, body: request.method() === "PUT" ? request.postDataJSON() : null });
      if (request.method() === "GET") return route.fulfill({ json: { configured: options.configured ?? false, revision: 0, source: "none", updatedAt: null, canEdit: options.canEdit ?? true, encryptionReady: options.ready ?? true, storageReady: options.ready ?? true, scope: { organizationId: "fixture-org", workspaceId: scope } } });
      if (options.delayed) { state.pending = true; await new Promise<void>(resolve => { state.release = resolve; }); }
      await route.fulfill(options.fail ? { status: 409, json: { error: "凭据已被其他管理员更新，请重新读取配置后核对再保存。" } } : { json: { configured: true, revision: 1, source: "database" } }).catch(() => undefined);
      return;
    }
    if (url.origin !== "http://fixture.local") return route.abort();
    return route.fulfill({ contentType: "text/html", body: '<html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div></body></html>' });
  });
  await page.goto("http://fixture.local/settings?tab=integrations#sellfox-credentials");
  await page.addStyleTag({ content: styles }); await page.addScriptTag({ content: bundle });
  await expect(page.getByText("保存范围：fixture-org / workspace-a", { exact: true })).toBeVisible();
  return { calls, state };
}

test("masked form submits scoped credentials once and clears secrets after success", async ({ page }) => {
  const { calls, state } = await setup(page, { delayed: true });
  const id = page.getByLabel("Client ID（必填）", { exact: true });
  const secret = page.getByLabel("Client Secret（必填）", { exact: true });
  await expect(id).toHaveAttribute("type", "password"); await expect(secret).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "保存赛狐凭据" }).click();
  expect(calls.filter(c => c.method === "PUT")).toHaveLength(0);
  await id.fill("fixture-id"); await secret.fill("fixture-secret");
  await page.getByRole("button", { name: "保存赛狐凭据" }).click();
  await expect.poll(() => state.pending).toBe(true);
  await expect(page.getByRole("button", { name: "正在保存…" })).toBeDisabled();
  expect(calls.filter(c => c.method === "PUT")).toEqual([{ method: "PUT", scope: "workspace-a", body: { clientId: "fixture-id", clientSecret: "fixture-secret", revision: 0 } }]);
  state.release();
  await expect(page.getByRole("status")).toContainText("赛狐凭据已保存");
  await expect(page.locator('input[name="clientId"]')).toHaveValue(""); await expect(page.locator('input[name="clientSecret"]')).toHaveValue("");
  await expect(page.getByText(/来源：工作区加密配置 · 版本 1/)).toBeVisible();
  const storage = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]));
  expect(storage).not.toMatch(/fixture-secret|fixture-id/);
});

test("revision conflict preserves inputs and provides a reload action", async ({ page }) => {
  await setup(page, { fail: true });
  await page.locator('input[name="clientId"]').fill("fixture-id"); await page.locator('input[name="clientSecret"]').fill("fixture-secret");
  await page.getByRole("button", { name: "保存赛狐凭据" }).click();
  await expect(page.getByText("凭据已被其他管理员更新，请重新读取配置后核对再保存。", { exact: true })).toBeVisible();
  await expect(page.locator('input[name="clientSecret"]')).toHaveValue("fixture-secret");
  await page.getByRole("button", { name: "重新读取配置" }).click();
  await expect(page.locator('input[name="clientSecret"]')).toHaveValue("");
});

test("workspace switch destroys input and ignores a late previous save response", async ({ page }) => {
  const { state } = await setup(page, { delayed: true });
  await page.locator('input[name="clientId"]').fill("old-id"); await page.locator('input[name="clientSecret"]').fill("old-secret");
  await page.getByRole("button", { name: "保存赛狐凭据" }).click(); await expect.poll(() => state.pending).toBe(true);
  await page.evaluate(() => { localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b" })); window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")); });
  await expect(page.getByText("保存范围：fixture-org / workspace-b", { exact: true })).toBeVisible();
  state.release();
  await expect(page.locator('input[name="clientSecret"]')).toHaveValue("");
  await expect(page.getByRole("status")).toHaveCount(0);
});

for (const kind of ["permission", "storage"] as const) test(`${kind} gate prevents credential submission`, async ({ page }) => {
  const { calls } = await setup(page, kind === "permission" ? { canEdit: false } : { ready: false });
  await expect(page.getByRole("button", { name: "保存赛狐凭据" })).toBeDisabled();
  await expect(page.locator('input[name="clientSecret"]')).toBeDisabled();
  if (kind === "storage") await expect(page.getByText("凭据表尚未就绪，请管理员按审批流程应用当前版本迁移。页面不会自动执行迁移。", { exact: true })).toBeVisible();
  expect(calls.filter(c => c.method === "PUT")).toHaveLength(0);
});

test("connection test requires saved credentials and reports success without submitting form values", async ({ page }) => {
  const { calls, state } = await setup(page, { configured: true, delayed: true });
  await page.locator('input[name="clientSecret"]').fill("unsaved-secret");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect.poll(() => state.pending).toBe(true);
  await expect(page.getByRole("button", { name: "正在测试连接…" })).toBeDisabled();
  expect(calls.filter(c => c.method === "POST")).toEqual([{ method: "POST", scope: "workspace-a", body: null }]);
  expect(JSON.stringify(calls)).not.toContain("unsaved-secret");
  state.release();
  await expect(page.getByRole("status")).toContainText("连接成功");
});

test("connection test displays a sanitized failure", async ({ page }) => {
  await setup(page, { configured: true, testFailure: true });
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("IP 不在白名单");
});

test("connection test result from previous workspace cannot appear after a scope switch", async ({ page }) => {
  const { state } = await setup(page, { configured: true, delayed: true });
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect.poll(() => state.pending).toBe(true);
  await page.evaluate(() => { localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b" })); window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")); });
  await expect(page.getByText("保存范围：fixture-org / workspace-b", { exact: true })).toBeVisible();
  state.release();
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "测试连接", exact: true })).toBeEnabled();
});
