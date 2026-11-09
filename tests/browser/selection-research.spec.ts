import { build } from "esbuild";
import { expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { LocalResearchStore } from "../../src/lib/selection-research/file-store";
import { ResearchEngine } from "../../src/lib/selection-research/engine";
import { researchFixture } from "../../src/lib/selection-research/fixture";
import { renderResearchReport, renderResearchStageReport } from "../../src/lib/selection-research/report";
import { SKILLS, ToolNotDispatchedError, type Decision, type Run } from "../../src/lib/selection-research/types";
import { researchReadiness } from "../../src/lib/selection-research/preflight";
import type { ProviderStatus, RuntimeTool } from "../../src/lib/lili/runtime-tools";

let bundle: string;
test.beforeAll(async () => {
  bundle = (await build({ entryPoints: ["tests/browser/selection-research-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } })).outputFiles[0].text;
});
for (const scenario of ["normal", "save-failure", "pause", "agent-failure"] as const) test(`isolated UI exercises both gates, reload and evidence recovery: ${scenario}`, async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "research-browser-"));
  try {
    const fixture = researchFixture();
    let failAgent = scenario === "agent-failure";
    const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "mock-org", workspaceId: "default", ownerId: "mock-owner" }, fixture.transport, { async next(context) {
      if (failAgent) { failAgent = false; throw new Error("RESEARCH_AI_REQUEST_FAILED"); }
      const action = await fixture.agent.next(context);
      if (scenario === "normal" && context.run.stage === 1 && action.type === "complete") {
        action.result.claims.push({ kind: "calculated", text: "隔离公式展示测试", formula: "2 / 1 = 2（隔离展示）", evidenceIds: [context.run.calls[0].id] });
        action.result.claims.push({ kind: "assumption", text: '<script data-isolated>window.__liliUnexpected = 1</script>', sourceUrl: "javascript:window.__liliUnexpected=1", evidenceIds: [] });
      }
      return action;
    } }, { mode: "fixture" });
    let run: Run | undefined;
    let steps = 0;
    let exports = 0;
    let failHistory = false;
    let heldHistory: Promise<void> | undefined;
    let releaseStep!: () => void;
    const stepHeld = new Promise<void>(resolve => { releaseStep = resolve; });
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
      if (route.request().method() === "GET") {
        if (url.pathname.endsWith("/report")) {
          const savedRun = await engine.inspect(run!.id);
          const phase = url.searchParams.get("stage");
          const html = phase === null ? renderResearchReport(savedRun) : renderResearchStageReport(savedRun, Number(phase));
          return route.fulfill({ contentType: "text/html", headers: { "content-disposition": 'attachment; filename="selection.html"' }, body: html });
        }
        if (url.pathname === "/api/selection-research") {
          if (heldHistory) await heldHistory;
          return failHistory ? route.fulfill({ status: 503, json: { error: "ISOLATED_HISTORY_UNAVAILABLE" } }) : route.fulfill({ json: { runs: run ? [{ id: run.id, status: run.status, input: { requirement: run.requirement } }] : [] } });
        }
        return route.fulfill({ json: { run: await engine.inspect(run!.id) } });
      }
      const body = route.request().postDataJSON();
      if (url.pathname === "/api/selection-research") run = await engine.create({ requirement: body.requirement, marketplace: body.marketplace, policies: fixture.policies, limits: {}, skills: SKILLS.map((name) => ({ name, path: `fixture/${name}`, markdown: "fixture", sha256: createHash("sha256").update("fixture").digest("hex"), tools: [] })) });
      else if (body.operation === "step") { steps++; if (scenario === "pause" && steps === 1) await stepHeld; run = await engine.step(run!.id); }
      else if (body.operation === "decide") run = await engine.decide(run!.id, body.decision as Decision);
      else if (body.operation === "recover") run = await engine.recover(run!.id);
      else if (body.operation === "export") {
        exports++;
        if (scenario === "save-failure" && exports === 1) return route.fulfill({ status: 503, json: { error: "ISOLATED_STORAGE_UNAVAILABLE" } });
        const saved = await engine.saveReport(run!.id, async current => { renderResearchReport(current); return "mock-file-id"; }); run = saved.run; return route.fulfill({ json: saved });
      }
      else return route.fulfill({ status: 400, json: { error: "Unexpected test operation" } });
      return route.fulfill({ json: { run } });
    });
    await page.goto("http://selection.invalid/");
    await page.getByLabel("运行模式").selectOption("fixture");
    await page.getByLabel("自然语言选品要求").fill("美国站宠物用品，离线流程验证");
    await page.getByRole("button", { name: "创建隔离样本任务" }).click();
    await expect(page).toHaveURL(/runId=[a-f0-9-]+/);
    await page.getByRole("button", { name: "继续到下一确认节点" }).click();
    if (scenario === "agent-failure") {
      await expect(page.getByRole("alert")).toContainText("AI 服务请求失败");
      await page.getByRole("button", { name: "恢复失败任务", exact: true }).click();
      await page.getByRole("button", { name: "继续到下一确认节点" }).click();
    }
    if (scenario === "pause") {
      await expect.poll(() => steps).toBe(1);
      await page.getByRole("button", { name: "暂停后续步骤" }).click();
      releaseStep();
      await expect(page.getByRole("button", { name: "继续到下一确认节点" })).toBeEnabled();
      expect(steps).toBe(1);
      await page.getByRole("button", { name: "继续到下一确认节点" }).click();
    }
    await expect(page.getByRole("heading", { name: "需要人工确认：NICHE" })).toBeVisible();
    expect(steps).toBe(scenario === "agent-failure" ? 3 : 2); expect(run!.stage).toBe(1);
    await expect(page.getByText("下载单文件 HTML 报告", { exact: true })).toHaveCount(0);
    const review = page.getByRole("region", { name: "研究结论与证据", exact: true });
    const audit = page.getByRole("region", { name: "审批与保存记录", exact: true });
    await expect(audit).toContainText("第一次业务确认：尚未确认");
    await expect(audit).toContainText("第二次业务确认：尚未确认");
    await expect(audit).toContainText("需先完成两次业务确认");
    await expect(review).toContainText("隔离样本，仅验证流程");
    await expect(review.getByRole("article", { name: "阶段 1 研究结果", exact: true })).toBeVisible();
    if (scenario === "normal") {
      const stage = review.getByRole("article", { name: "阶段 1 研究结果", exact: true });
      const phaseDownload = page.waitForEvent("download");
      await stage.getByRole("link", { name: "下载第 1 阶段 HTML 报告（待审阅）", exact: true }).click();
      const download = await phaseDownload;
      const phasePath = path.join(root, "stage-1.html");
      await download.saveAs(phasePath);
      expect(await readFile(phasePath, "utf8")).toContain("待人工审阅");
      expect(run!.stage).toBe(1); expect(run!.decisions).toHaveLength(0);
      await expect(stage).toContainText("计算公式：2 / 1 = 2（隔离展示）");
      await expect(stage).toContainText("假设，待验证");
      await expect(stage).toContainText("未引用成功调用证据");
      await expect(stage.locator("script[data-isolated]")).toHaveCount(0);
      await expect(stage.locator('a[href^="javascript:"]')).toHaveCount(0);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__liliUnexpected)).toBeUndefined();
      const citation = stage.getByRole("link", { name: /^证据：/ }).first();
      const evidence = review.locator((await citation.getAttribute("href"))!);
      await expect(evidence.locator("pre")).toHaveCount(0);
      await citation.click();
      await expect(evidence.locator("pre")).toContainText("isolated-fixture");
      await expect(evidence.locator("pre")).toContainText('"arguments"');
      expect(steps).toBe(2); expect(exports).toBe(0);
      await evidence.locator("summary").click();
      await expect(evidence.locator("pre")).toHaveCount(0);
    }
    await page.reload();
    await expect(page.getByRole("heading", { name: "需要人工确认：NICHE" })).toBeVisible();
    if (scenario === "normal") await expect(review).toContainText("计算公式：2 / 1 = 2（隔离展示）");
    await page.getByRole("button", { name: /选择：流程测试方向 2/ }).click();
    await expect(page.getByRole("heading", { name: "需要人工确认：FINAL" })).toBeVisible();
    expect(run!.status).toBe("WAITING_FOR_USER"); expect(run!.results).toHaveLength(5);
    await expect(review.getByRole("article")).toHaveCount(5);
    await expect(review).toContainText("已选方向：流程测试方向 2");
    await expect(review).toContainText("仍需验证（NEEDS_VALIDATION）");
    await expect(review).toContainText("税率未核验");
    await expect(audit).toContainText("第一次业务确认：已记录");
    await expect(audit).toContainText("第二次业务确认：尚未确认");
    await expect(audit).toContainText(run!.decisions[0].at);
    await expect(audit).toContainText("操作者 ID：mock-owner");
    expect(exports).toBe(0);
    await page.getByRole("button", { name: "确认研究结果，允许生成报告" }).click();
    if (scenario === "save-failure") {
      await expect(page.getByRole("alert")).toContainText("研究已完成，但报告保存失败");
      expect(run!.status).toBe("COMPLETED"); expect(run!.decisions).toHaveLength(2); expect(exports).toBe(1);
      await expect(audit).toContainText("第二次业务确认：已记录");
      await expect(audit).toContainText("报告尚无保存记录。若保存失败");
      await page.reload();
      await expect(page.getByRole("heading", { name: /COMPLETED/ })).toBeVisible();
      await expect(audit).toContainText("报告尚无保存记录。若保存失败");
      await page.getByRole("button", { name: "保存 HTML 报告", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("mock-file-id");
      expect(exports).toBe(2); expect(run!.decisions).toHaveLength(2);
    }
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "下载单文件 HTML 报告" }).click();
    expect((await download).suggestedFilename()).toBe("selection.html");
    await expect(page.getByRole("status")).toContainText("mock-file-id");
    await page.reload();
    await expect(page.getByRole("link", { name: "下载保存的 HTML 报告" })).toBeVisible();
    await expect(audit).toContainText("HTML 报告保存记录已存在");
    await expect(audit).toContainText("FileObject：mock-file-id");
    await expect(audit).toContainText(run!.report!.savedAt);
    if (scenario === "normal") {
      failHistory = true;
      let releaseHistory!: () => void;
      heldHistory = new Promise<void>(resolve => { releaseHistory = resolve; });
      const writesBefore = { steps, exports, decisions: run!.decisions.length };
      await page.reload();
      await expect(page.getByRole("link", { name: "下载保存的 HTML 报告" })).toBeVisible();
      await expect(audit).toContainText("第二次业务确认：已记录");
      releaseHistory(); heldHistory = undefined;
      await expect(page.getByRole("alert")).toContainText("历史列表暂时读取失败；当前任务已恢复");
      expect({ steps, exports, decisions: run!.decisions.length }).toEqual(writesBefore);
      failHistory = false;
    }
    await page.getByText("Skill 快照、调用证据及审批记录").click();
    await expect(page.locator("details").filter({ has: page.getByText("Skill 快照、调用证据及审批记录", { exact: true }) }).locator("pre")).toContainText("rawResponse");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")));
    await expect(page.getByRole("heading", { name: /第 5 \/ 5 阶段/ })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("runId")).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("workspace switch discards a late registry result and clears the saved task link", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
    if (url.pathname === "/api/selection-research/discover") {
      requested = true;
      await held;
      return route.fulfill({ json: { providers: [{ provider: "old-workspace-provider", status: "connected", toolCount: 7 }] } });
    }
    if (url.pathname === "/api/selection-research") return route.fulfill({ json: { runs: [], availability: {} } });
    return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
  });
  await page.goto("http://selection.invalid/");
  await page.getByRole("button", { name: "检查工具与启动条件（不创建任务、不取市场数据）", exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")));
  const response = page.waitForResponse(url => url.url().endsWith("/discover"));
  release(); await response;
  await expect(page.getByRole("button", { name: "检查工具与启动条件（不创建任务、不取市场数据）", exact: true })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("old-workspace-provider");
});

test("workspace switch discards a late saved-run response and its approval records", async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "research-late-restore-"));
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requested = false;
  try {
    const fixture = researchFixture();
    const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "mock-org", workspaceId: "default", ownerId: "mock-owner" }, fixture.transport, fixture.agent, { mode: "fixture" });
    const run = await engine.create({ requirement: "Isolated old workspace task", marketplace: "US", policies: fixture.policies, limits: {}, skills: SKILLS.map(name => ({ name, path: "isolated", markdown: "isolated", sha256: "isolated", tools: [] })) });
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
      if (url.pathname === `/api/selection-research/${run.id}`) { requested = true; await held; return route.fulfill({ json: { run } }); }
      if (url.pathname === "/api/selection-research") return route.fulfill({ json: { runs: [] } });
      return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
    });
    await page.goto(`http://selection.invalid/?runId=${run.id}`);
    await expect.poll(() => requested).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")));
    const response = page.waitForResponse(result => result.url().endsWith(run.id));
    release(); await response;
    await expect(page.getByRole("region", { name: "审批与保存记录", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /第 1 \/ 5 阶段/ })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("runId")).toBe(false);
  } finally { release(); await rm(root, { recursive: true, force: true }); }
});

test("startup checks show exact missing prerequisites and never create a task or call a model", async ({ page }) => {
  let ai = "missing_existing_model_configuration", creations = 0;
  const providers: ProviderStatus[] = (["erp", "sellersprite", "xiyou"] as const).map(provider => ({ provider, status: "connected", toolCount: 1 }));
  const tools: RuntimeTool[] = providers.map(({ provider }) => ({ provider, name: `${provider}__isolated_read`, remoteName: "isolated_read", inputSchema: { type: "object" }, permission: provider === "erp" ? "read" : "approval_required", availability: "available" }));
  const skills = SKILLS.map(name => ({ name, path: "isolated", markdown: "isolated", sha256: "isolated", tools: [] }));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
    if (url.pathname === "/api/selection-research/discover") {
      const request = route.request().postDataJSON();
      expect(request.marketplace).toBe("US"); expect(request.maxMarketCalls).toBeUndefined(); expect(request.budgetMode).toBe("uncapped");
      return route.fulfill({ json: { providers, tools, readiness: researchReadiness({ providers, tools, ai, skills, request }), aiRequestCount: 0, toolsCallCount: 0, persisted: false } });
    }
    if (url.pathname === "/api/selection-research") {
      if (route.request().method() === "POST") creations++;
      return route.fulfill({ json: { runs: [], availability: { ai } } });
    }
    return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
  });
  await page.goto("http://selection.invalid/");
  const check = page.getByRole("button", { name: "检查工具与启动条件（不创建任务、不取市场数据）", exact: true });
  await check.click();
  const panel = page.getByRole("region", { name: "真实研究启动检查", exact: true });
  await expect(panel.getByRole("heading")).toHaveText("真实研究尚有阻塞项");
  await expect(panel).toContainText("ai · 未就绪"); await expect(panel).toContainText("input · 未就绪");
  await page.getByLabel("目标 ASIN", { exact: true }).fill("B000000001");
  await page.getByLabel("自然语言选品要求").fill("Isolated startup check, no market facts");
  ai = "configured";
  await check.click();
  await expect(panel.getByRole("heading")).toHaveText("连接配置与输入检查通过");
  await expect(panel).toContainText("尚未发起模型请求验证");
  expect(creations).toBe(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("amazon-bulk-ad:workspace-scope-changed")));
  await expect(panel).toHaveCount(0);
});

test("explicit server model choice reaches discovery and creation and is retained by a restored run", async ({ page }) => {
  const sources: string[] = [];
  const restored = { id: "isolated-selected-model", version: 1, revision: 0, scope: { organizationId: "mock-org", workspaceId: "default", ownerId: "mock-owner" },
    requirement: "Isolated model selection", asin: "B000000001", marketplace: "US", mode: "live", status: "CREATED", stage: 1,
    aiConfigSource: "server_runtime", aiModel: { provider: "isolated", model: "isolated-model" }, calls: [], decisions: [], actions: [], results: [], policies: {}, limits: {}, skills: [], registry: [] };
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
    if (url.pathname === "/api/selection-research/discover") {
      sources.push(route.request().postDataJSON().aiConfigSource);
      return route.fulfill({ json: { providers: [], tools: [], aiModel: restored.aiModel, readiness: { ready: true, checks: [] } } });
    }
    if (url.pathname === "/api/selection-research") {
      if (route.request().method() === "POST") { sources.push(route.request().postDataJSON().aiConfigSource); return route.fulfill({ json: { run: restored } }); }
      return route.fulfill({ json: { runs: [] } });
    }
    if (url.pathname.endsWith(restored.id)) return route.fulfill({ json: { run: restored } });
    return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
  });
  await page.goto("http://selection.invalid/");
  await page.getByLabel("目标 ASIN", { exact: true }).fill("B000000001");
  await page.getByLabel("自然语言选品要求").fill(restored.requirement);
  await page.getByLabel("AI 模型来源", { exact: true }).selectOption("server_runtime");
  await page.getByRole("button", { name: "检查工具与启动条件（不创建任务、不取市场数据）", exact: true }).click();
  await expect(page.getByRole("region", { name: "真实研究启动检查", exact: true })).toContainText("isolated / isolated-model");
  await page.getByRole("button", { name: "读取在线工具目录并创建真实任务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "第 1 / 5 阶段 · CREATED", exact: true })).toBeVisible();
  expect(sources).toEqual(["server_runtime", "server_runtime"]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "第 1 / 5 阶段 · CREATED", exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("任务保存的模型：isolated / isolated-model · 来源：已有服务端模型");
});

test("pre-dispatch failure survives reload with zero requests and recovery requires a new approval", async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "research-not-sent-browser-"));
  try {
    let blocked = true, dispatches = 0;
    const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "mock-org", workspaceId: "default", ownerId: "mock-owner" }, {
      async listTools() { return [{ name: "product_research", inputSchema: { type: "object", properties: { request: { type: "string" } }, required: ["request"] } }]; },
      async callTool() { if (blocked) throw new ToolNotDispatchedError("RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN"); dispatches++; return { requestId: "isolated" }; },
    }, { async next({ run }) { return { type: "call", tool: "product_research", arguments: { request: String(run.calls.length + 1) } }; } }, { mode: "live", authorizeLive: async () => true });
    let run = await engine.create({ requirement: "Isolated UI non-dispatch test", marketplace: "US", skills: SKILLS.map(name => ({ name, path: "isolated", markdown: "isolated", sha256: "isolated", tools: [] })), policies: { product_research: { provider: "sellersprite", paid: true, units: 1, unit: "calls", pricingSource: "isolated", maxCalls: 1, stages: [1] } }, limits: { sellersprite: 1 } });
    run = await engine.step(run.id);
    run = await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
    run = await engine.step(run.id);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
      if (route.request().method() === "GET") return route.fulfill({ json: url.pathname === "/api/selection-research" ? { runs: [] } : { run: await engine.inspect(run.id) } });
      const body = route.request().postDataJSON();
      if (body.operation === "recover") run = await engine.recover(run.id);
      else if (body.operation === "step") run = await engine.step(run.id);
      else if (body.operation === "decide") run = await engine.decide(run.id, body.decision);
      else throw new Error("UNEXPECTED_OPERATION");
      return route.fulfill({ json: { run } });
    });
    await page.goto(`http://selection.invalid/?runId=${run.id}`);
    await expect(page.getByRole("alert")).toContainText("业务请求未发送");
    await expect(page.locator("body")).toContainText("SellerSprite 请求次数：0 / 1");
    await expect(page.locator("body")).toContainText("这些业务请求未发送，不占用调用预算");
    await page.reload();
    await expect(page.locator("body")).toContainText("SellerSprite 请求次数：0 / 1");
    blocked = false;
    await page.getByRole("button", { name: "恢复失败任务", exact: true }).click();
    await page.getByRole("button", { name: "继续到下一确认节点" }).click();
    await expect(page.getByRole("heading", { name: "需要人工确认：MCP_CALL" })).toBeVisible();
    expect(dispatches).toBe(0);
    await page.getByRole("button", { name: "批准本任务的付费查询并执行首笔" }).click();
    await expect(page.getByRole("heading", { name: "任务调用上限已达" })).toBeVisible();
    await expect(page.locator("body")).toContainText("SellerSprite 请求次数：1 / 1");
    await expect(page.locator("body")).toContainText("不会再申请额度审批");
    await expect(page.getByRole("button", { name: "批准提高调用上限" })).toHaveCount(0);
    expect(dispatches).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const outcome of ["lost-response", "interrupted"] as const) test(`free ERP read review survives reload and never replays: ${outcome}`, async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "research-free-review-browser-"));
  try {
    let dispatches = 0;
    const store = new LocalResearchStore(root);
    const engine = new ResearchEngine(store, { organizationId: "mock-org", workspaceId: "default", ownerId: "mock-owner" }, {
      async listTools() { return [{ name: "erp__read_product", inputSchema: { type: "object", properties: {} } }]; },
      async callTool() { dispatches++; throw new Error("isolated lost response"); },
    }, { async next() { return { type: "call", tool: "erp__read_product", arguments: {} }; } }, { mode: "live", authorizeLive: async () => true });
    let run = await engine.create({ requirement: "Isolated free read recovery test", marketplace: "US", skills: SKILLS.map(name => ({ name, path: "isolated", markdown: "isolated", sha256: "isolated", tools: [] })), policies: { erp__read_product: { provider: "erp", paid: false, units: 0, unit: "calls", pricingSource: "isolated", maxCalls: 2, stages: [1] } }, limits: {} });
    run = await engine.step(run.id);
    if (outcome === "interrupted") {
      await store.transaction(run.id, async (current, save) => { current.status = "RUNNING"; delete current.gate; current.calls[0].status = "IN_FLIGHT"; await save(); });
      run = await engine.step(run.id);
    }
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
      if (route.request().method() === "GET") return route.fulfill({ json: url.pathname === "/api/selection-research" ? { runs: [] } : { run: await engine.inspect(run.id) } });
      const body = route.request().postDataJSON();
      if (body.operation === "decide") {
        expect(body.decision.units).toBe(0);
        run = await engine.decide(run.id, body.decision);
      } else if (body.operation === "step") run = await engine.step(run.id);
      else throw new Error("UNEXPECTED_OPERATION");
      return route.fulfill({ json: { run } });
    });
    await page.goto(`http://selection.invalid/?runId=${run.id}`);
    await expect(page.getByLabel("读取核对说明", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("读取核对说明", { exact: true })).toBeVisible();
    await expect(page.getByLabel("实际扣费单位", { exact: true })).toHaveCount(0);
    await expect(page.locator("body")).toContainText(`待核对：erp__read_product · 请求 ${run.calls[0].id}`);
    const confirm = page.getByRole("button", { name: "确认结果未核实，保留记录并继续", exact: true });
    await expect(confirm).toBeDisabled();
    await page.getByLabel("读取核对说明", { exact: true }).fill("Isolated review: request outcome remains unverified");
    await confirm.click();
    await expect(page.getByRole("alert")).toContainText("检测到重复请求");
    expect(dispatches).toBe(1);
    expect(run.calls[0].status).toBe("FAILED");
    expect(run.calls[0].rawResponse).toBeUndefined();
    expect(run.decisions[0].decision.units).toBe(0);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("检测到重复请求");
    expect(dispatches).toBe(1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("first task approval runs later paid calls within the saved limit without fee review gates", async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "research-task-approval-browser-"));
  try {
    let dispatches = 0;
    const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "mock-org", workspaceId: "default", ownerId: "mock-owner" }, {
      async listTools() { return [{ name: "product_research", inputSchema: { type: "object", properties: { page: { type: "integer" } }, required: ["page"] } }]; },
      async callTool() { dispatches++; return { requestId: `isolated-${dispatches}` }; },
    }, { async next({ run }) { return { type: "call", tool: "product_research", arguments: { page: run.calls.length + 1 } }; } }, { mode: "live", authorizeLive: async () => true });
    let run = await engine.create({ requirement: "Isolated task-level approval test", marketplace: "US", skills: SKILLS.map(name => ({ name, path: "isolated", markdown: "isolated", sha256: "isolated", tools: [] })), policies: { product_research: { provider: "sellersprite", paid: true, units: 1, unit: "calls", pricingSource: "isolated", maxCalls: 2, stages: [1] } }, limits: { sellersprite: 2 } });
    run = await engine.step(run.id);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
      if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
      if (route.request().method() === "GET") return route.fulfill({ json: url.pathname === "/api/selection-research" ? { runs: [] } : { run: await engine.inspect(run.id) } });
      const body = route.request().postDataJSON();
      if (body.operation === "decide") run = await engine.decide(run.id, body.decision);
      else if (body.operation === "step") run = await engine.step(run.id);
      else throw new Error("UNEXPECTED_OPERATION");
      return route.fulfill({ json: { run } });
    });
    await page.goto(`http://selection.invalid/?runId=${run.id}`);
    await expect(page.getByRole("heading", { name: "需要人工确认：MCP_CALL" })).toBeVisible();
    await expect(page.locator("body")).toContainText("sellersprite 2 次");
    await page.getByRole("button", { name: "批准本任务的付费查询并执行首笔" }).click();
    await expect(page.getByRole("heading", { name: "任务调用上限已达" })).toBeVisible();
    expect(dispatches).toBe(2);
    expect(run.calls.map(call => call.authorizationMode)).toEqual(["FIRST_APPROVAL", "TASK_APPROVAL"]);
    expect(run.calls.every(call => call.billing === "UNKNOWN" && call.authorizationId === run.paidCallAuthorization?.id)).toBe(true);
    await expect(page.getByRole("button", { name: "批准提高调用上限" })).toHaveCount(0);
    await expect(page.getByLabel("扣费凭据", { exact: true })).toHaveCount(0);
    const audit = page.getByRole("region", { name: "审批与保存记录", exact: true });
    await expect(audit).toContainText("第一次业务确认：尚未确认");
    await audit.getByText("工具授权、费用及额度记录（1 条）", { exact: true }).click();
    await expect(audit).toContainText("任务首次付费授权");
    await expect(audit).toContainText("逐笔付费调用记录（2 条）");
    await expect(audit).toContainText("沿用本任务授权");
    await page.reload();
    const restoredAudit = page.getByRole("region", { name: "审批与保存记录", exact: true });
    await restoredAudit.getByText("工具授权、费用及额度记录（1 条）", { exact: true }).click();
    await expect(restoredAudit).toContainText("逐笔付费调用记录（2 条）");
    await expect(restoredAudit).toContainText("任务付费授权已记录");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("live budget UI defaults to uncapped research without a mandatory call ceiling", async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
    if (url.pathname === "/api/selection-research") {
      if (route.request().method() === "POST") {
        submitted = route.request().postDataJSON();
        return route.fulfill({ status: 409, json: { error: "ISOLATED_STOP_BEFORE_REAL_TASK" } });
      }
      return route.fulfill({ json: { runs: [] } });
    }
    return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
  });
  await page.goto("http://selection.invalid/");
  await expect(page.getByLabel("预算模式", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("最大市场调用次数", { exact: true })).toHaveValue("");
  await page.getByLabel("自然语言选品要求").fill("Isolated generic research task");
  await page.getByRole("button", { name: "读取在线工具目录并创建真实任务", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("ISOLATED_STOP_BEFORE_REAL_TASK");
  expect(submitted?.budgetMode).toBe("uncapped");
  expect(submitted?.maxMarketCalls).toBeUndefined();
  expect(submitted?.mode).toBe("live");
});

test("isolated receipt form converts costs, persists the original receipt and leaves market dispatch unchanged", async ({ page }) => {
  const root = await mkdtemp(path.join(tmpdir(), "research-credits-browser-"));
  let dispatches = 0;
  try {
    const tool = { name: "market_find_products", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };
    const engine = new ResearchEngine(new LocalResearchStore(root), { organizationId: "mock-org", workspaceId: "default", ownerId: "mock-owner" }, {
      async listTools() { return [tool]; }, async callTool() { dispatches++; return { records: [] }; },
    }, { async next(): Promise<never> { throw new Error("NO_MODEL"); } }, { mode: "live", authorizeLive: async () => true });
    let run = await engine.create({ executionMode: "codex", budgetMode: "uncapped", requirement: "产品方向：arrow bag quiver", marketplace: "US", skills: SKILLS.map(name => ({ name, path: "fixture", markdown: "fixture", sha256: "fixture", tools: [] })),
      registry: [tool], policies: { [tool.name]: { provider: "sellersprite", paid: true, units: 1, unit: "calls", maxCalls: 1, stages: [1], pricingSource: "unknown" } }, limits: { sellersprite: 0 } });
    run = await engine.step(run.id, { action: { type: "call", tool: tool.name, arguments: { query: "fixture" } }, revision: run.revision });
    run = await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
    run = await engine.step(run.id);
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "selection.invalid") throw new Error("UNEXPECTED_NETWORK_REQUEST");
      if (url.pathname === "/api/selection-research") return route.fulfill({ json: { runs: [] } });
      if (url.pathname === `/api/selection-research/${run.id}`) {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON(); expect(body.operation).toBe("record-charge");
          run = await engine.recordCharge(run.id, body);
        }
        return route.fulfill({ json: { run } });
      }
      return route.fulfill({ contentType: "text/html", body: `<div id="root"></div><script>${bundle}</script>` });
    });
    await page.goto(`http://selection.invalid/?runId=${run.id}`);
    await page.getByText("登记研究费用与积分凭据", { exact: true }).click();
    await page.getByLabel("费用请求", { exact: true }).selectOption(run.calls[0].id);
    await page.getByLabel("费用原始单位", { exact: true }).selectOption("USD");
    await page.getByLabel("费用原始数量", { exact: true }).fill("2");
    await page.getByLabel("费用换算率", { exact: true }).fill("7");
    await page.getByLabel("费用换算日期", { exact: true }).fill("2026-11-08");
    await page.getByLabel("费用换算来源", { exact: true }).fill("fixture rate only");
    await page.getByLabel("费用凭据", { exact: true }).fill("fixture receipt");
    await expect(page.getByText("折合：1400研究积分", { exact: true })).toBeVisible();
    await page.getByLabel("费用性质", { exact: true }).selectOption("confirmed");
    await page.getByRole("button", { name: "确认凭据并登记实耗", exact: true }).click();
    const audit = page.getByRole("region", { name: "审批与保存记录", exact: true });
    await expect(audit).toContainText("已确认 1400");
    expect(run.calls[0].researchCharge?.unit).toBe("USD"); expect(run.creditAdjustments).toHaveLength(1); expect(dispatches).toBe(1);
    await page.reload(); await expect(page.getByRole("region", { name: "审批与保存记录", exact: true })).toContainText("已确认 1400");
  } finally { await rm(root, { recursive: true, force: true }); }
});
