import { build } from "esbuild";
import { expect, test } from "@playwright/test";
let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/amazon-audits-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
});
test("audit panel confirms, dry-runs, shows old/new and isolates workspace", async ({ page }) => {
  const audit = { id: "audit-test", status: "PREVIEW", idempotencyKey: "preview-test-key", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), confirmedAt: null as string | null,
    preview: { approvalId: "approval-test", plan: { warnings: ["广告新鲜度 UNKNOWN"] } }, oldValues: [{ target: "row", bid: 1 }], newValues: { requested: [{ target: "row", bid: 1.1 }], execution: undefined as { code: string; message: string } | undefined } };
  const writes: Array<{ path: string; body: unknown; workspace?: string }> = [];
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:43221");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
    const workspace = request.headers()["x-workspace-id"];
    if (request.method() === "GET") return route.fulfill({ json: { rows: workspace === "workspace-a" ? [audit] : [] } });
    writes.push({ path: url.pathname, body: request.postDataJSON(), workspace });
    if (url.pathname.includes("/approvals/")) { audit.confirmedAt = new Date().toISOString(); return route.fulfill({ json: { audit } }); }
    audit.newValues.execution = { code: "EXECUTION_DISABLED", message: "仅 dry_run，未写 Amazon。" };
    return route.fulfill({ json: { audit, execution: audit.newValues.execution } });
  });
  await page.goto("http://127.0.0.1:43221/");
  await expect(page.getByText("广告新鲜度 UNKNOWN", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "执行检查 / dry_run" })).toHaveCount(0);
  await page.getByRole("button", { name: "确认预览", exact: true }).click();
  await page.getByRole("button", { name: "执行检查 / dry_run" }).click();
  await expect(page.getByText("EXECUTION_DISABLED · 仅 dry_run，未写 Amazon。", { exact: true })).toBeVisible();
  await page.getByText("查看 old/new 与执行结果").click();
  await expect(page.locator("pre")).toContainText('"bid": 1.1');
  expect(writes).toEqual([{ path: "/api/agents/approvals/approval-test", body: { decision: "APPROVED", reason: "内部 ERP 人工复核出价预览" }, workspace: "workspace-a" }, { path: "/api/agents/ppc/audits/audit-test/apply", body: { idempotencyKey: "preview-test-key" }, workspace: "workspace-a" }]);
  await page.evaluate(() => { localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b" })); window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")); });
  await expect(page.getByText("当前工作区暂无审计。", { exact: true })).toBeVisible();
  await expect(page.getByText(/audit-test/)).toHaveCount(0);
});
test("audit panel shows load failures", async ({ page }) => {
  await page.route("**/*", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (path.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "没有审计查看权限" } });
    return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
  });
  await page.goto("http://127.0.0.1:43221/");
  await expect(page.getByRole("alert")).toHaveText("没有审计查看权限");
});

test("late apply failure cannot leak into another workspace; old nullable audit fields remain readable", async ({ page }) => {
  let started = false; let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const audit = { id: "audit-old", status: "PREVIEW", idempotencyKey: "preview-old-key", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), confirmedAt: new Date().toISOString(), preview: null, oldValues: null, newValues: null };
  await page.route("**/*", async (route) => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    if (path === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!path.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<div id="root"></div><script src="/bundle.js"></script>' });
    if (request.method() === "GET") return route.fulfill({ json: { rows: request.headers()["x-workspace-id"] === "workspace-a" ? [audit] : [] } });
    started = true; await pending;
    return route.fulfill({ status: 501, json: { execution: { code: "NOT_IMPLEMENTED", message: "旧工作区迟到失败" } } });
  });
  await page.goto("http://127.0.0.1:43221/");
  await expect(page.getByText("PREVIEW · audit-old", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "执行检查 / dry_run" }).click();
  await expect.poll(() => started).toBe(true);
  await page.evaluate(() => { localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b" })); window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")); });
  await expect(page.getByText("当前工作区暂无审计。", { exact: true })).toBeVisible();
  release();
  await expect(page.getByText("旧工作区迟到失败", { exact: true })).toHaveCount(0);
});
