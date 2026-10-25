import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import { createHandoff, handoffProvenance, handoffStorageKeys } from "@/lib/agent-platform/handoff";
import { resolveLaunchOutput } from "@/lib/agent-platform/launch-gate";
import { createOrchestratorExecutionExecutor, createOrchestratorInternalAdapter, orchestratorAgentDefinition, orchestratorToolDefinitions } from "@/lib/agent-platform/orchestrator";
import { createMarketAgentExecutionExecutor, createSellerSpriteMcpAdapter, marketAgentDefinition, marketToolDefinitions } from "@/lib/agent-platform/market";
import { createProductAgentExecutionExecutor, createProductMcpAdapter, productAgentDefinition, productToolDefinitions } from "@/lib/agent-platform/product";
import { createSupplierAgentExecutionExecutor, createSupplierMcpAdapter, supplierAgentDefinition, supplierToolDefinitions } from "@/lib/agent-platform/supplier";
import { createListingAgentExecutionExecutor, createListingMcpAdapter, listingAgentDefinition, listingToolDefinitions } from "@/lib/agent-platform/listing";
import { createPpcAgentExecutionExecutor, createPpcAnalyticsAdapter, ppcAgentDefinition, ppcToolDefinitions } from "@/lib/agent-platform/ppc";
import { createSelectionAdapter } from "@/lib/agent-platform/selection";
import type { AgentExecutionDetail } from "@/lib/agent-platform/types";

import selectionSample from "../fixtures/selection/evidence.json";
import { parseSelectionEvidence } from "@/lib/agent-platform/selection-evidence";

let bundle: string;
const surfaces = {
  orchestrator: { definition: orchestratorAgentDefinition, tools: orchestratorToolDefinitions, adapters: [createOrchestratorInternalAdapter()], executor: createOrchestratorExecutionExecutor },
  market: { definition: marketAgentDefinition, tools: marketToolDefinitions, adapters: [createSellerSpriteMcpAdapter(), createSelectionAdapter()], executor: createMarketAgentExecutionExecutor },
  product: { definition: productAgentDefinition, tools: productToolDefinitions, adapters: [createProductMcpAdapter()], executor: createProductAgentExecutionExecutor },
  supplier: { definition: supplierAgentDefinition, tools: supplierToolDefinitions, adapters: [createSupplierMcpAdapter()], executor: createSupplierAgentExecutionExecutor },
  listing: { definition: listingAgentDefinition, tools: listingToolDefinitions, adapters: [createListingMcpAdapter()], executor: createListingAgentExecutionExecutor },
  ppc: { definition: ppcAgentDefinition, tools: ppcToolDefinitions, adapters: [createPpcAnalyticsAdapter()], executor: createPpcAgentExecutionExecutor },
};

test.beforeAll(async () => {
  const result = await build({
    entryPoints: ["tests/browser/agent-chain-harness.tsx"], bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [{ name: "framework-navigation-fixture", setup(builder) {
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, (args) => ({ path: args.path, namespace: "framework" }));
      builder.onLoad({ filter: /.*/, namespace: "framework" }, (args) => ({ loader: "js", contents: args.path === "next/navigation" ? "export const useRouter = () => ({prefetch() {}});" : "import React from 'react'; export default function Link({href,prefetch,...props}) {return React.createElement('a',{...props,href});}", resolveDir: process.cwd() }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

async function setup(page: Page) {
  const latest = new Map<string, AgentExecutionDetail>();
  const selectionFiles = new Map<string, unknown>();
  const calls: { stage: string; body: Record<string, unknown> }[] = [];
  const delay = { market: false, release: () => {}, upload: false, releaseUpload: () => {} };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(); const url = new URL(request.url());
    expect(url.origin).toBe("http://127.0.0.1:43221");
    if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "application/javascript", body: bundle });
    if (!url.pathname.startsWith("/api/")) return route.fulfill({ contentType: "text/html", body: '<html><body><div id="root"></div><script src="/bundle.js"></script></body></html>' });
    if (url.pathname === "/api/agents/ppc/audits") return route.fulfill({ json: { rows: [] } });
    if (url.pathname === "/api/workspace/draft-runs") return route.fulfill({ json: { draftRuns: [] } });
    if (url.pathname === "/api/workspace/snapshot") return route.fulfill({ json: { snapshot: null } });
    expect(["workspace-a", "workspace-b"]).toContain(request.headers()["x-workspace-id"]);
    if (url.pathname === "/api/agents/market/selection-evidence") {
      const data = JSON.parse(request.postData()!);
      try { parseSelectionEvidence(data); }
      catch { return route.fulfill({ status: 400, json: { error: "选品证据无效。" } }); }
      const fileId = `selection-${request.headers()["x-workspace-id"]}`;
      selectionFiles.set(fileId, data);
      if (delay.upload) await new Promise<void>((resolve) => { delay.releaseUpload = resolve; });
      return route.fulfill({ status: 201, json: { fileId, keyword: data.brief.keyword } });
    }
    if (url.pathname.startsWith("/api/agents/approvals/")) {
      const current = latest.get("orchestrator")!;
      const approved = request.postDataJSON().decision === "APPROVED";
      const output = resolveLaunchOutput(current.output, approved, { approvalId: current.approvals[0].id, executionId: current.id, planId: (current.output as unknown as { plan: { planId: string } }).plan.planId });
      current.output = output as unknown as AgentExecutionDetail["output"];
      current.approvals[0].status = approved ? "APPROVED" : "REJECTED";
      return route.fulfill({ json: { execution: current } });
    }
    const stage = url.pathname.split("/")[3] as keyof typeof surfaces;
    const surface = surfaces[stage];
    expect(surface).toBeTruthy();
    if (request.method() === "POST") {
      const body = request.postDataJSON(); calls.push({ stage, body });
      const runtime = createAgentRuntime({ definitions: [surface.definition], tools: surface.tools, adapters: stage === "market" ? [createSellerSpriteMcpAdapter(), createSelectionAdapter({ loadEvidence: async (fileId) => {
        expect(fileId).toBe(`selection-${request.headers()["x-workspace-id"]}`);
        return { value: selectionFiles.get(fileId), source: { fileId, sha256: "a".repeat(64) } };
      } })] : surface.adapters });
      const result = await runtime.run({ agentId: stage, context: { currentData: body.context?.currentData ?? {}, marketplace: "US" }, input: { handoff: handoffProvenance(body.chainHandoff) as never }, workspaceId: "workspace-a", executor: surface.executor({ request: body, requestedByUserId: "actor" }) });
      const detail: AgentExecutionDetail = { ...result.execution, approvals: result.approvals, traces: result.traces, toolCalls: result.toolCalls, events: result.events };
      latest.set(stage, detail);
      if (stage === "market" && delay.market) await new Promise<void>((resolve) => { delay.release = resolve; });
      return route.fulfill({ json: { ...result, executions: [] } });
    }
    return route.fulfill({ json: { agent: surface.definition, tools: surface.tools, executions: [], memoryItems: [], latestExecution: request.headers()["x-workspace-id"] === "workspace-a" ? latest.get(stage) ?? null : null } });
  });
  return { latest, calls, errors, delay };
}

test("actual six workbenches pass versioned payloads and approval unlocks PPC without historical rows", async ({ page }) => {
  const state = await setup(page);
  await page.goto("http://127.0.0.1:43221/agents/orchestrator");
  await page.getByRole("button", { name: "运行编排", exact: true }).click();
  await expect(page.getByText("blocked_until_launch", { exact: true })).toBeVisible();
  const blockedPpc = page.getByText("launch → PPC Agent", { exact: true }).locator("..").locator("..");
  await blockedPpc.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page.getByText("blocked_until_launch：请先完成 Launch 人工审批。", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/agents\/orchestrator(?:\?|$)/);
  // Source label is derived from the existing stage name rather than agent title.
  const marketRow = page.getByText("user → Market Agent", { exact: true }).locator("..").locator("..");
  await marketRow.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/market$/);
  await expect(page.getByText("已加载交接，运行前请复核。", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "运行研究", exact: true }).click();
  await expect(page.getByRole("note").filter({ hasText: "模拟数据不可作为全链路验收" })).toBeVisible();
  await page.getByRole("button", { name: "发送到产品 Agent", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/product$/);
  await page.getByRole("button", { name: "运行产品 Agent", exact: true }).click();
  await page.getByRole("button", { name: "发送到供应 Agent", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/supplier$/);
  await page.getByRole("button", { name: "运行供应 Agent", exact: true }).click();
  await page.getByRole("button", { name: "确认供应方案并交接刊登", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/listing$/);
  await page.getByRole("button", { name: "运行刊登 Agent", exact: true }).click();
  await page.getByRole("button", { name: "确认刊登稿并交接 Launch", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/orchestrator(?:\?|$)/);
  // Incoming listing cannot accidentally approve a previous unrelated plan.
  await expect(page.getByRole("button", { name: "确认清单并批准 Launch" })).toHaveCount(0);
  await page.getByRole("button", { name: "运行编排", exact: true }).click();
  const chainCard = page.getByRole("heading", { name: "链路执行", exact: true }).locator("..").locator("..");
  for (const stage of ["market", "product", "supplier", "listing"]) {
    await expect(chainCard.locator(`a[href="/agents/${stage}?executionId=${state.latest.get(stage)!.id}"]`)).toHaveCount(1);
  }
  await page.getByRole("button", { name: "确认清单并批准 Launch", exact: true }).click();
  const ppcRow = page.getByText("launch → PPC Agent", { exact: true }).locator("..").locator("..");
  await ppcRow.getByRole("button", { name: "打开", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/ppc$/);
  await page.getByRole("button", { name: "运行 PPC Agent", exact: true }).click();
  await expect.poll(() => state.calls.filter((call) => call.stage === "ppc").length).toBe(1);
  await expect(page.getByRole("heading", { name: "建议报告", exact: true })).toBeVisible();
  for (const call of state.calls.slice(1)) expect((call.body.chainHandoff as { _handoff: { version: number } })._handoff.version).toBe(1);
  const supplier = state.calls.find((call) => call.stage === "supplier")!;
  expect(supplier.body.productReport).toBeTruthy();
  const listing = state.calls.find((call) => call.stage === "listing")!;
  expect((listing.body.context as { currentData: { supplierReport: unknown } }).currentData.supplierReport).toBeTruthy();
  const ppc = state.calls.find((call) => call.stage === "ppc")!;
  expect((ppc.body.chainHandoff as { launchApproval: { approvalId: string } }).launchApproval.approvalId).toBeTruthy();
  expect((ppc.body.chainHandoff as { _handoff: { kind: string } })._handoff.kind).toBe("LaunchTicket");
  expect(state.errors).toEqual([]);
});

test("switching workspace discards a late execution and cannot hand off its report", async ({ page }) => {
  const state = await setup(page);
  state.delay.market = true;
  await page.goto("http://127.0.0.1:43221/agents/market");
  await page.getByRole("button", { name: "运行研究", exact: true }).click();
  await expect.poll(() => state.calls.length).toBe(1);
  await page.evaluate(() => {
    localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b", marketplace: "US" }));
    window.dispatchEvent(new Event("amazon-bulk-ad:workspace-scope-changed"));
  });
  state.delay.release();
  await expect(page.getByRole("button", { name: "运行研究", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "发送到产品 Agent", exact: true })).toBeDisabled();
  expect(state.errors).toEqual([]);
});

test("future-version and foreign-workspace handoffs show errors; unapproved PPC remains disabled", async ({ page }) => {
  await setup(page);
  await page.goto("http://127.0.0.1:43221/agents/orchestrator");
  const payload = createHandoff({ goal: "Blocked launch", marketplace: "US", status: "blocked_until_launch" }, { organizationId: "org", userId: "actor", workspaceId: "workspace-a", from: "orchestrator", to: "ppc", kind: "PpcPlan", sourceExecutionId: "source" });
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: handoffStorageKeys.ppc, value: payload });
  await page.goto("http://127.0.0.1:43221/agents/ppc");
  await expect(page.getByRole("button", { name: "运行 PPC Agent", exact: true })).toBeDisabled();
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: handoffStorageKeys.ppc, value: { ...payload, _handoff: { ...payload._handoff, version: 99 } } });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("版本");
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: handoffStorageKeys.ppc, value: { ...payload, _handoff: { ...payload._handoff, workspaceId: "other" } } });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("工作区");
});


test("Round B evidence passes Market, Product, Supplier and Listing without invented quotations", async ({ page }) => {
  const state = await setup(page);
  await page.goto("http://127.0.0.1:43221/agents/market");
  const button = page.getByRole("button", { name: "从 Round B 证据生成机会", exact: true });
  await expect(button).toBeDisabled();
  await page.getByLabel("Round B 采集草稿", { exact: true }).setInputFiles({ name: "draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...selectionSample, suppliers: [{ title: "Browser cover lead", shopName: "", url: "https://detail.1688.com/offer/123456.html", price: "", moq: "" }] })) });
  await expect(page.getByText("草稿已上传，可以生成机会。", { exact: true })).toBeVisible();
  await button.click();
  await expect(page.getByText("证据完整度 75/100", { exact: true })).toBeVisible();
  await expect(page.getByText("需求 未知", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发送到产品 Agent", exact: true }).click();
  await expect(page).toHaveURL(/\/agents\/product$/);
  await page.getByRole("button", { name: "运行产品 Agent", exact: true }).click();
  await expect.poll(() => state.calls.some((call) => call.stage === "product")).toBe(true);
  const handoff = state.calls.find((call) => call.stage === "product")!.body as { marketReport: { selectionSource: { fileId: string } }; marketOpportunity: { estimatedMargin: unknown } };
  expect(handoff.marketReport.selectionSource.fileId).toBe("selection-workspace-a");
  expect(handoff.marketOpportunity.estimatedMargin).toBe(null);
  await page.getByRole("button", { name: "发送到供应 Agent", exact: true }).click();
  await page.getByRole("button", { name: "运行供应 Agent", exact: true }).click();
  await expect(page.getByRole("heading", { name: "供应商线索（待核实）", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看 1688 原始线索", exact: true })).toHaveAttribute("href", "https://detail.1688.com/offer/123456.html");
  await expect(page.getByText("待核实 / 未报价 / 待核实", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认供应方案并交接刊登", exact: true }).click();
  await page.getByRole("button", { name: "运行刊登 Agent", exact: true }).click();
  await expect.poll(() => state.calls.some((call) => call.stage === "listing")).toBe(true);
  const listing = state.calls.find((call) => call.stage === "listing")!.body as { context: { currentData: { supplierReport: { selectionSource: { fileId: string }; quotationAnalysis: { unitPrice: string; score: number | null }[] } } } };
  expect(listing.context.currentData.supplierReport.selectionSource.fileId).toBe("selection-workspace-a");
  expect(listing.context.currentData.supplierReport.quotationAnalysis[0]).toMatchObject({ unitPrice: "未报价", score: null });
  expect(state.errors).toEqual([]);
});


test("workspace switch cannot revive a late Round B upload", async ({ page }) => {
  const state = await setup(page);
  state.delay.upload = true;
  await page.goto("http://127.0.0.1:43221/agents/market");
  const started = page.waitForRequest("**/api/agents/market/selection-evidence");
  await page.getByLabel("Round B 采集草稿", { exact: true }).setInputFiles({ name: "draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(selectionSample)) });
  await started;
  await page.evaluate(() => {
    localStorage.setItem("amazon_bulk_ad_workspace_scope", JSON.stringify({ workspaceId: "workspace-b", marketplace: "US" }));
    window.dispatchEvent(new Event("amazon-bulk-ad:workspace-scope-changed"));
  });
  state.delay.releaseUpload();
  // The new workspace reload may clear the transient error; it must never restore old evidence.
  await expect(page.getByRole("button", { name: "从 Round B 证据生成机会", exact: true })).toBeDisabled();
  await expect(page.getByText("草稿已上传，可以生成机会。", { exact: true })).toHaveCount(0);
});


test("empty Round B shortlist blocks Supplier UI handoff to Listing", async ({ page }) => {
  const state = await setup(page);
  await page.goto("http://127.0.0.1:43221/agents/market");
  await page.getByLabel("Round B 采集草稿", { exact: true }).setInputFiles({ name: "draft.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(selectionSample)) });
  await page.getByRole("button", { name: "从 Round B 证据生成机会", exact: true }).click();
  await page.getByRole("button", { name: "发送到产品 Agent", exact: true }).click();
  await page.getByRole("button", { name: "运行产品 Agent", exact: true }).click();
  await page.getByRole("button", { name: "发送到供应 Agent", exact: true }).click();
  await page.getByRole("button", { name: "运行供应 Agent", exact: true }).click();
  await expect(page.getByText("已整理 0 条 Round B 供应线索；未完成供应商核验或正式核价。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认供应方案并交接刊登", exact: true })).toBeDisabled();
  expect(state.errors).toEqual([]);
});
