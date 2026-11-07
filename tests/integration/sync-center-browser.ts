import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { Worker } from "bullmq";
import { GET, POST } from "@/app/api/operations/sync-center/route";
import { POST as approvalPost } from "@/app/api/operations/sync-center/approvals/route";
import { createSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { processSyncCenterTask } from "@/lib/amazon-sync/processor";
import { tickSyncCenter } from "@/lib/amazon-sync/scheduler";
import { createRedisConnectionOptions, amazonSyncQueueName, getAmazonSyncQueue } from "@/lib/queue/redis-queue";

/** Real browser + HTTP Route Handlers + database login + queue; only Amazon transport is mocked by caller. */
export async function exerciseSyncCenterBrowser(input: { organizationId: string; workspaceId: string; actorId: string; approverId: string; storeId: string; setValidTransport: () => void }) {
  const bundle = (await build({ entryPoints: ["tests/browser/sync-center-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  const [{ default: postcss }, { default: tailwind }] = await Promise.all([import("postcss"), import("@tailwindcss/postcss")]);
  const css = (await postcss([tailwind() as unknown as import("postcss").AcceptedPlugin]).process(await readFile("src/app/globals.css", "utf8"), { from: "src/app/globals.css" })).css;
  const failures: string[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
      if (url.pathname === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle); return; }
      if (url.pathname === "/styles.css") { res.setHeader("content-type", "text/css"); res.end(css); return; }
      if (["/api/operations/sync-center", "/api/operations/sync-center/approvals"].includes(url.pathname)) {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const request = new Request(url, { method: req.method, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks).toString() } : {}) });
        const response = url.pathname.endsWith("/approvals") ? await approvalPost(request) : req.method === "POST" ? await POST(request) : await GET(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      if (url.pathname !== "/") { res.statusCode = 404; res.end(); return; }
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.end('<html><head><meta charset="utf-8"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
    })().catch(() => { failures.push("HTTP fixture failed"); res.statusCode = 500; res.end("Fixture failed"); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Fixture address unavailable");
  const origin = `http://127.0.0.1:${address.port}`;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let worker: Worker<{ runId: string; dispatchVersion: number }> | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    await context.route("**/*", async route => { if (new URL(route.request().url()).origin !== origin) { failures.push("Unexpected external browser request"); await route.abort(); } else await route.continue(); });
    const session = await createSession(input.actorId);
    const approverSession = await createSession(input.approverId);
    await context.addCookies([{ name: session.sessionCookie.name, value: session.sessionCookie.value, url: origin, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(({ workspaceId }) => localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId })), { workspaceId: input.workspaceId });
    const page = await context.newPage();
    page.on("pageerror", () => failures.push("Browser uncaught exception"));
    const postAction = (action: string) => page.waitForResponse(response => response.url().includes("/api/operations/sync-center") && response.request().method() === "POST" && response.request().postDataJSON().action === action);
    const applyApproval = async (response: Awaited<ReturnType<typeof postAction>>) => {
      assert.equal(response.status(), 202);
      const { changeRequest } = await response.json();
      const approvalUrl = `${origin}/api/operations/sync-center/approvals`;
      const decision = await context.request.post(approvalUrl, { headers: { "x-workspace-id": input.workspaceId, cookie: `${approverSession.sessionCookie.name}=${approverSession.sessionCookie.value}` }, data: { id: changeRequest.id, decision: "APPROVED" } });
      assert.equal(decision.status(), 200);
      const enabledScopes = process.env.AMAZON_SYNC_CENTER_SCOPES;
      if (response.request().postDataJSON().action === "validate-authorization") process.env.AMAZON_SYNC_CENTER_SCOPES = "[]";
      let applied: Awaited<ReturnType<typeof context.request.post>>;
      try { applied = await context.request.post(approvalUrl, { headers: { "x-workspace-id": input.workspaceId }, data: { id: changeRequest.id, decision: "APPLY" } }); }
      finally { process.env.AMAZON_SYNC_CENTER_SCOPES = enabledScopes; }
      assert.equal(applied.status(), 200, await applied.text());
      return String(changeRequest.id);
    };
    await page.goto(`${origin}/?entry=1`);
    await expect(page.getByRole("heading", { name: "数据同步健康状态", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "店铺与授权", exact: true }).click();
    await page.getByRole("button", { name: "新增授权", exact: true }).click();
    await page.getByLabel("授权名称", { exact: true }).fill("Browser Seller C");
    await page.getByLabel("Amazon Seller ID（业务同步时填写真实编号）").fill("BROWSER_SELLER_C");
    await page.getByLabel("lwaClientId", { exact: true }).fill("browser-fixture-client");
    await page.getByLabel("lwaClientSecret", { exact: true }).fill("browser-fixture-secret");
    await page.getByLabel("refreshToken", { exact: true }).fill("browser-fixture-refresh");
    const saved = postAction("save-authorization");
    await page.getByRole("button", { name: "保存授权", exact: true }).click();
    await applyApproval(await saved);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    const authPanel = page.locator("section").filter({ has: page.getByRole("heading", { name: "Browser Seller C", exact: true }) });
    const verified = postAction("validate-authorization");
    await authPanel.getByRole("button", { name: "验证参与站点", exact: true }).click();
    await applyApproval(await verified);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(authPanel.getByText("US (ATVPDKIKX0DER)", { exact: false })).toBeVisible();
    await page.getByLabel("已验证授权", { exact: true }).selectOption({ label: "Browser Seller C / BROWSER_SELLER_C" });
    await page.getByLabel("ERP 店铺", { exact: true }).selectOption(input.storeId);
    await page.getByLabel("已验证 Marketplace", { exact: true }).selectOption("ATVPDKIKX0DER");
    const bound = postAction("save-source");
    await page.getByRole("button", { name: "保存数据源", exact: true }).click();
    await applyApproval(await bound);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    const binding = page.locator("div.border-t").filter({ hasText: "Browser Fixture Store / ATVPDKIKX0DER / FBA 库存" });
    const created = postAction("run");
    await binding.getByRole("button", { name: "同步此范围", exact: true }).click();
    const changeId = await applyApproval(await created);
    const { id: taskId } = await prisma.amazonSyncRun.findFirstOrThrow({ where: { organizationId: input.organizationId, workspaceId: input.workspaceId, executionApprovalId: changeId } });
    await getAmazonSyncQueue().obliterate({ force: true });
    worker = new Worker(amazonSyncQueueName, job => processSyncCenterTask(job.data.runId, job.data.dispatchVersion), { connection: createRedisConnectionOptions(), concurrency: 1 });
    const dispatch = async () => {
      const activeWorker = worker!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let completed: (job: { data: { runId: string } }) => void = () => {};
      let errored: (error: Error) => void = () => {};
      try {
        const finished = new Promise<void>((resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Browser fixture task timed out")), 15000);
          completed = job => { if (job.data.runId === taskId) resolve(); }; errored = reject;
          activeWorker.on("completed", completed); activeWorker.on("error", errored);
        });
        await tickSyncCenter(new Date(), { taskIds: [taskId], exportIds: [] }); await finished;
      } finally { if (timer) clearTimeout(timer); activeWorker.off("completed", completed); activeWorker.off("error", errored); }
    };
    await dispatch(); // Caller intentionally supplies invalid Amazon response for the first attempt.
    assert.equal((await prisma.amazonSyncRun.findUniqueOrThrow({ where: { id: taskId } })).status, "FAILED");
    await page.getByRole("button", { name: "同步任务", exact: true }).click();
    await page.getByRole("row").filter({ hasText: taskId.slice(0, 12) }).getByRole("button", { name: "详情", exact: true }).click();
    await expect(page.getByRole("button", { name: "查看本次快照", exact: true })).toBeDisabled();
    await expect(page.getByText("同步配置、响应完整性或检查点校验失败；未发布新快照。请核对数据源及授权后重试。", { exact: true })).toBeVisible();
    input.setValidTransport();
    const retry = postAction("control-task");
    await page.getByRole("button", { name: "重试完整快照", exact: true }).click();
    await applyApproval(await retry);
    await dispatch();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.getByRole("button", { name: "查看本次快照", exact: true }).click();
    await expect(page.getByRole("cell", { name: /BROWSER-SELLER-C-SKU/ })).toBeVisible();
    await expect(page.getByText(/Seller BROWSER_SELLER_C · ATVPDKIKX0DER/)).toBeVisible();
    assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes("browser-fixture-refresh")), false);
    assert.deepEqual(failures, []);
  } finally {
    await browser?.close(); await worker?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
