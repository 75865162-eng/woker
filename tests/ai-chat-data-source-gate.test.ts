import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const dataSources = read("src/lib/ai-chat/data-sources.ts");
const runtime = read("src/lib/ai-chat/runtime.ts");
const orchestrator = read("src/lib/ai-chat/orchestrator.ts");
const messagesRoute = read("src/app/api/ai/chat/conversations/[id]/messages/route.ts");
const dsRoute = read("src/app/api/ai/chat/data-sources/route.ts");
const workspace = read("src/components/ai-chat/ai-chat-workspace.tsx");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20261228000000_ai_chat_data_source_config/migration.sql");

test("数据源配置表按三元组唯一，enabledProviders 数组落库", () => {
  assert.match(schema, /model AiChatDataSourceConfig[\s\S]{0,500}enabledProviders\s+String\[\]/);
  assert.match(schema, /@@unique\(\[organizationId, workspaceId, userId\]\)/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "AiChatDataSourceConfig"/);
  assert.match(migration, /"enabledProviders" TEXT\[\]/);
});

test("预检只读两套 MCP 凭证，不暴露 token，并汇总权限范围", () => {
  assert.match(dataSources, /listMcpCredentials/);
  assert.match(dataSources, /listSellfoxMcpCredentials/);
  assert.match(dataSources, /status === "ACTIVE"/);
  assert.match(dataSources, /expiresAt\.getTime\(\) > Date\.now\(\)/);
  assert.ok(!/tokenHash|tokenPrefix: [^,]*\n.*return/.test(dataSources.split("export async function inspectChatDataSources")[1]?.slice(0, 2000) ?? ""), "预检结果不得含 tokenHash");
  assert.match(dataSources, /scopeSummary/);
  assert.match(dataSources, /toolCount/);
});

test("保存配置只能启用确有 ACTIVE 凭证的 provider，且必须属于白名单", () => {
  assert.match(dataSources, /CHAT_DATA_PROVIDERS\.includes/);
  assert.match(dataSources, /configured\.has\(p as ChatDataProvider\)/);
  assert.match(dataSources, /enabledProviders/);
});

test("门禁：未配置或全部禁用即抛 MCP_NOT_CONFIGURED", () => {
  assert.match(dataSources, /export async function requireEnabledChatDataSources/);
  assert.match(dataSources, /if \(!snapshot\.ready\)/);
  assert.match(dataSources, /err\.code = "MCP_NOT_CONFIGURED"/);
});

test("messages 在建立 run 之前执行数据源门禁，409 返回且不落库", () => {
  const gateAt = messagesRoute.indexOf("requireEnabledChatDataSources(scope)");
  const prepareAt = messagesRoute.indexOf("prepareUserMessage(scope");
  const runAt = messagesRoute.indexOf("createRun(scope");
  assert.ok(gateAt > 0 && prepareAt > 0 && runAt > 0, "三处调用都应存在");
  assert.ok(gateAt < prepareAt && prepareAt < runAt, "门禁必须早于消息落库与 run 创建");
  assert.match(messagesRoute, /status: 409/);
  assert.match(messagesRoute, /code: "MCP_NOT_CONFIGURED"/);
  assert.match(messagesRoute, /sessionGuard, enabledProviders \}\)/);
});

test("runtime 只装配被显式启用的 provider，Amazon 走凭证约束身份", () => {
  assert.match(runtime, /enabledProviders\?: ChatDataProvider\[\]/);
  assert.match(runtime, /const enabled = new Set<string>\(enabledProviders \?\? \[\]\)/);
  assert.match(runtime, /if \(enabled\.has\("amazon"\)\)/);
  assert.match(runtime, /if \(enabled\.has\("sellfox"\)\)/);
  assert.match(runtime, /createChatAmazonMcpIdentity\(scope\)/);
  assert.ok(!runtime.includes("createErpSessionAmazonMcpIdentity"), "Amazon 不得再用全量 ERP session 身份");
});

test("Amazon 凭证身份非全量，按 id 复核库内 tools/scopes", () => {
  const mcp = read("src/lib/amazon-sync/mcp.ts");
  assert.match(mcp, /export async function createChatAmazonMcpIdentity/);
  assert.match(mcp, /status: "ACTIVE", expiresAt: \{ gt: new Date\(\) \}/);
  assert.match(mcp, /validateAmazonMcpCredential\(row\)/);
  assert.match(mcp, /return \{ \.\.\.validated, tools: await accountToolsForLili\(validated\) \}/);
});

test("orchestrator 透传 enabledProviders", () => {
  assert.match(orchestrator, /enabledProviders: ChatDataProvider\[\]/);
  assert.match(orchestrator, /buildChatRuntime\(scope, input\.sessionGuard, input\.enabledProviders\)/);
});

test("前端配置面板：预检、勾选、保存、未配置禁用输入", () => {
  assert.match(workspace, /\/api\/ai\/chat\/data-sources/);
  assert.match(workspace, /enabledProviders: dsSelected/);
  assert.match(workspace, /dataSources\?\.ready/);
  assert.match(workspace, /disabled=\{!dataSources\?\.ready\}/);
  assert.match(workspace, /请先确认启用至少一个可用的 MCP 数据源/);
  assert.match(workspace, /管理 MCP 凭证/);
  assert.match(workspace, /\/\?tab=mcp|\/settings\?tab=mcp/);
});

test("预检 API 使用 agents view/create 权限并带工作区头", () => {
  assert.match(dsRoute, /requireApiPermission\("agents", "view", request\)/);
  assert.match(dsRoute, /requireApiPermission\("agents", "create", request\)/);
  assert.match(dsRoute, /workspaceScopeFromRequest/);
  assert.match(dsRoute, /"Cache-Control": "no-store"/);
});
