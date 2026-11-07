import test from "node:test";
import assert from "node:assert/strict";
import { parseResearchInput, researchReadiness } from "@/lib/selection-research/preflight";
import { discoverResearchTools } from "@/lib/selection-research/server";
import { SKILLS } from "@/lib/selection-research/types";
import type { ProviderStatus, RuntimeTool } from "@/lib/lili/runtime-tools";
import { selectResearchAiSettings } from "@/lib/selection-research/ai-settings";
import { defaultAiModelSettings } from "@/lib/ai-settings";

const input = { mode: "live", asin: " b000000001 ", marketplace: " us ", requirement: " Isolated validation only ", maxMarketCalls: 3 };
const providers: ProviderStatus[] = ["erp", "sellersprite", "xiyou"].map(provider => ({ provider, status: "connected", toolCount: 1 })) as ProviderStatus[];
const tools: RuntimeTool[] = providers.map(({ provider }) => ({ provider, name: `${provider}__${provider === "sellersprite" ? "asin.detail" : "read"}`, remoteName: provider === "sellersprite" ? "asin.detail" : "read", inputSchema: { type: "object", properties: {} }, permission: provider === "erp" ? "read" : "approval_required", availability: "available" }));
const skills = SKILLS.map(name => ({ name, path: "isolated", markdown: "isolated", sha256: "isolated", tools: [] }));

test("model source selection is explicit, permission checked and never silently falls back", async () => {
  let runtimeReads = 0, workspaceReads = 0, allowed = false;
  const workspace = { ...defaultAiModelSettings, apiKey: "" };
  const runtime = { ...defaultAiModelSettings, apiKey: "isolated-server-key", model: "isolated-server-model" };
  const adapters = { async workspace() { workspaceReads++; return workspace; }, runtime() { runtimeReads++; return runtime; }, async authorizeRuntime() { return allowed; } };
  assert.equal(await selectResearchAiSettings(undefined, adapters), workspace);
  assert.equal(runtimeReads, 0);
  await assert.rejects(selectResearchAiSettings("server_runtime", adapters), /RESEARCH_RUNTIME_AI_PERMISSION_REQUIRED/);
  assert.equal(runtimeReads, 0);
  allowed = true;
  assert.equal(await selectResearchAiSettings("server_runtime", adapters), runtime);
  assert.equal(runtimeReads, 1); assert.equal(workspaceReads, 1);
  await assert.rejects(selectResearchAiSettings("automatic", adapters), /INVALID_RESEARCH_AI_SOURCE/);
  assert.equal(parseResearchInput({ ...input, aiConfigSource: "server_runtime" }).aiConfigSource, "server_runtime");
});

test("creation requires an explicit mode and validates genuine inputs without falling back to samples", () => {
  for (const mode of [undefined, "lve", false, null]) assert.throws(() => parseResearchInput({ ...input, mode }), /EXPLICIT_RESEARCH_MODE_REQUIRED/);
  const parsed = parseResearchInput(input);
  assert.equal(parsed.mode, "live"); assert.equal(parsed.asin, "B000000001"); assert.equal(parsed.marketplace, "US"); assert.equal(parsed.requirement, "Isolated validation only");
  assert.equal(parseResearchInput({ ...input, mode: "fixture", maxMarketCalls: undefined }).mode, "fixture");
  for (const maxMarketCalls of [undefined, true, "3", 0, 31, 1.5]) assert.throws(() => parseResearchInput({ ...input, maxMarketCalls }), /MARKET_CALL_BUDGET/);
  for (const asin of [123, {}, "invalid"]) assert.throws(() => parseResearchInput({ ...input, asin }), /INVALID_ASIN/);
  assert.throws(() => parseResearchInput({ ...input, requirement: "  " }), /INVALID_RESEARCH_REQUEST/);
  assert.throws(() => parseResearchInput({ ...input, erpCredentialId: 123 }), /INVALID_ERP_CREDENTIAL_ID/);
  assert.throws(() => parseResearchInput({ ...input, requirement: "Bearer isolated-private-key" }), /CREDENTIAL_VALUE_REJECTED/);
});

test("readiness reports configuration and input blockers independently and never equates discovery with business success", () => {
  const ready = researchReadiness({ providers, tools, skills, ai: "configured", request: input });
  assert.equal(ready.ready, true); assert.equal(ready.checks.length, 6);
  assert.match(ready.checks.find(check => check.id === "ai")!.message, /尚未发起模型请求/);
  assert.match(ready.checks.find(check => check.id === "erp")!.message, /业务数据尚未调用/);
  const blocked = researchReadiness({ providers, tools: tools.map(tool => ({ ...tool, availability: "blocked" })), skills: skills.slice(0, 4), ai: "missing_existing_model_configuration", request: { requirement: "" } });
  assert.equal(blocked.ready, false);
  assert.ok(blocked.checks.every(check => check.status === "blocked"));
  const disconnected = researchReadiness({ providers: [], tools: [], ai: "configured", skills, request: input });
  assert.equal(disconnected.ready, false); assert.equal(disconnected.checks.filter(check => check.status === "blocked").length, 3);
});

test("creation reuses its actual discovery snapshot without a second registry request", async () => {
  let reads = 0;
  const transport = { async listTools() { reads++; return tools; } };
  const filtered = await discoverResearchTools(transport, tools);
  assert.equal(reads, 0); assert.equal(filtered.registry.length, 3);
  assert.deepEqual(filtered.registry[0].inputSchema, tools[0].inputSchema);
  assert.equal((await discoverResearchTools(transport, [])).registry.length, 0);
  assert.equal(reads, 0);
  assert.equal((await discoverResearchTools(transport)).registry.length, 3);
  assert.equal(reads, 1);
});
