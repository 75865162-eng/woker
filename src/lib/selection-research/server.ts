import { requireApiPermission } from "@/lib/auth/api-permissions";
import type { PermissionAction } from "@/lib/accounts/permissions";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getSellerSpriteMcpSettings } from "@/lib/server/integration-settings";
import { resolveUserAiTextSettings } from "@/lib/server/user-ai-settings";
import { createResearchAiAgent } from "./ai-agent";
import { ResearchEngine, READ_TOOLS, canonicalResearchTool } from "./engine";
import { LeaseResearchStore } from "./lease-store";
import { prismaResearchRepository } from "./prisma-repository";
import { researchFixture } from "./fixture";
import { sellerSpritePolicy } from "./seller-transport";
import { loadResearchSkills, loadBundledResearchSkills } from "./skills";
import { runtimeToolsForUser } from "@/lib/lili/runtime-server";
import type { RuntimeTool } from "@/lib/lili/runtime-tools";
import type { ToolPolicy, ToolDefinition } from "./types";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { NextResponse } from "next/server";
import { storedResearchEngine } from "./http";
import { selectResearchAiSettings } from "./ai-settings";
import { resolveAiSettings } from "@/lib/server/ai-runtime";
import { researchRequestAuthorization } from "./request-authorization";

async function researchPermission(moduleId: string, action: PermissionAction, request: Request) {
  const verified = researchRequestAuthorization(request);
  return verified ? verified.authorize(moduleId, action, request) : requireApiPermission(moduleId, action, request);
}

async function selectedAiSettings(request: Request, user: { id: string; organizationId: string }, workspaceId: string, source: unknown) {
  return selectResearchAiSettings(source, {
    workspace: () => resolveUserAiTextSettings(user, { workspaceId, accountId: "", marketplace: "" }),
    runtime: () => resolveAiSettings(undefined, "text"),
    authorizeRuntime: async () => {
      const permission = await researchPermission("settings", "edit", request);
      return permission.ok && permission.user.id === user.id && permission.user.organizationId === user.organizationId;
    },
  });
}

export const researchNamespace = "selection-research-v1";
export async function researchAccess(request: Request, action: PermissionAction, body: Record<string, unknown> = {}) {
  const permission = await researchPermission("agents", action, request);
  if (!permission.ok) return permission;
  const workspaceId = workspaceScopeFromRequest(request, body).workspaceId;
  if (!await assertWorkspaceAccess(permission.user.organizationId, workspaceId)) return { ok: false as const, response: NextResponse.json({ error: "Forbidden workspace." }, { status: 403 }) };
  const scope = { organizationId: permission.user.organizationId, workspaceId, ownerId: permission.user.id };
  const fixture = researchFixture();
  const repository = prismaResearchRepository();
  let mode = body.mode === "live" ? "live" as const : "fixture" as const;
  if (typeof body.runId === "string") {
    let paused = false;
    try { const existing = (await repository.read(body.runId, scope)).run;
      paused = Boolean(existing.pausedAt);
      const credential = researchRequestAuthorization(request)?.credentialId;
      if (credential && (existing.mode !== "live" || existing.erpCredentialId !== credential)) return { ok: false as const, response: NextResponse.json({ error: "Research not found." }, { status: 404 }) };
      mode = existing.mode; body = { ...body, erpCredentialId: existing.erpCredentialId, aiConfigSource: existing.aiConfigSource, budgetMode: existing.budgetMode }; }
    catch { return { ok: false as const, response: NextResponse.json({ error: "Research not found." }, { status: 404 }) }; }
    if (paused || body.operation !== "step") return { ok: true as const, scope, engine: storedResearchEngine(new LeaseResearchStore(repository, scope), scope, mode) };
  }
  if (mode === "fixture") {
    const engine = new ResearchEngine(new LeaseResearchStore(repository, scope), scope, fixture.transport, fixture.agent, { mode });
    return { ok: true as const, scope, engine, fixture };
  }
  if (body.budgetMode === "mock_unlimited") throw new Error("LIVE_BUDGET_REVIEW_REQUIRED");
  const sellerSettings = await getSellerSpriteMcpSettings(permission.user, { workspaceId, accountId: "", marketplace: "" });
  if (!sellerSettings?.enabled || !sellerSettings.apiKey || !sellerSettings.serverUrl) throw new Error("SELLERSPRITE_MCP_NOT_CONFIGURED");
  const aiSettings = await selectedAiSettings(request, permission.user, workspaceId, body.aiConfigSource);
  if (!aiSettings.apiKey) throw new Error("AI_MODEL_NOT_CONFIGURED");
  const runtimeTools = await runtimeToolsForUser(permission.user, request, body);
  const transport = runtimeTools.transport;
  const agent = createResearchAiAgent(aiSettings);
  const engine = new ResearchEngine(new LeaseResearchStore(repository, scope), scope, transport, agent, {
    mode, authorizeLive: async (run) => run.scope.organizationId === permission.user.organizationId && run.scope.workspaceId === workspaceId && run.scope.ownerId === permission.user.id && Boolean(aiSettings.apiKey) && Boolean(sellerSettings?.enabled && sellerSettings.apiKey && sellerSettings.serverUrl),
  });
  return { ok: true as const, scope, engine, sellerSettings, aiSettings, transport, runtimeTools };
}

export async function getResearchAvailability(request: Request, body: Record<string, unknown> = {}) {
  const access = await researchAccess(request, "view", { mode: "fixture", workspaceId: body.workspaceId });
  if (!access.ok) return access;
  const user = (await researchPermission("agents", "view", request));
  if (!user.ok) return user;
  const workspaceId = access.scope.workspaceId;
  const [seller, ai] = await Promise.allSettled([
    getSellerSpriteMcpSettings(user.user, { workspaceId, accountId: "", marketplace: "" }),
    selectedAiSettings(request, user.user, workspaceId, body.aiConfigSource),
  ]);
  return { ok: true as const, scope: access.scope,
    sellerSprite: seller.status === "rejected" ? "provider_configuration_unavailable" : seller.value.enabled && Boolean(seller.value.apiKey && seller.value.serverUrl) ? "configured_runtime_registry_not_yet_checked" : "missing_existing_provider_configuration",
    ai: ai.status === "rejected" ? ai.reason instanceof Error && ai.reason.message === "RESEARCH_RUNTIME_AI_PERMISSION_REQUIRED" ? "runtime_model_permission_required" : "model_configuration_unavailable" : ai.value.apiKey ? "configured" : "missing_existing_model_configuration",
    aiModel: ai.status === "fulfilled" ? { provider: ai.value.provider, model: ai.value.model } : undefined,
    xiyou: "check_runtime_discovery", erp: "check_runtime_discovery" };
}
export async function discoverResearchTools(transport: { listTools(): Promise<ToolDefinition[]> }, snapshot?: ToolDefinition[]) {
  const registered = snapshot ?? await transport.listTools();
  const usable: ToolDefinition[] = [];
  const policies: Record<string, ToolPolicy> = {};
  const supported = new Set<string>();
  for (const tool of registered) {
    const runtime = tool as Partial<RuntimeTool>;
    const policy: ToolPolicy | null = runtime.provider === "erp" || runtime.provider === "skills" || runtime.provider === "xiyou"
      ? { provider: runtime.provider, paid: runtime.provider === "xiyou", units: runtime.provider === "xiyou" ? 1 : 0, unit: "calls", pricingSource: runtime.provider === "xiyou" ? "Provider charge unknown; review exact request before dispatch." : "Existing ERP/Skill read adapter; no external market request.", maxCalls: 15, stages: [1, 2, 3, 4, 5] }
      : sellerSpritePolicy(tool);
    if (!policy || !canonicalResearchTool(tool.name) || tool.annotations?.readOnlyHint === false) continue;
    usable.push(tool); policies[tool.name] = policy; supported.add(canonicalResearchTool(tool.name)!);
  }
  const missing = [...READ_TOOLS].filter((name) => !supported.has(name));
  return { registry: usable, policies, missing };
}
export async function installedResearchSkills() { return process.env.SELECTION_SKILL_ROOT ? loadResearchSkills(process.env.SELECTION_SKILL_ROOT) : loadBundledResearchSkills(); }
export function researchError(error: unknown) {
  if (error instanceof SyncInputError) return NextResponse.json({ error: "INVALID_RESEARCH_REQUEST" }, { status: error.status });
  const code = error instanceof Error ? error.message : "";
  const known = new Set(["RESEARCH_NOT_FOUND", "RESEARCH_SCOPE_DENIED", "RESEARCH_BUSY", "STALE_OR_MISSING_GATE", "INVALID_CANDIDATE", "DECISION_DOES_NOT_MATCH_GATE", "REPORT_REQUIRES_BOTH_HUMAN_GATES", "RESEARCH_MODE_MISMATCH", "BUDGET_MUST_INCREASE", "INVALID_BILLING_RECONCILIATION", "TERMINAL_RUN", "EXPLICIT_RECOVERY_REQUIRED", "RECOVERY_NOT_APPLICABLE", "SELLERSPRITE_MCP_NOT_CONFIGURED", "SELLERSPRITE_MCP_TOOL_NOT_FOUND", "SELLERSPRITE_MCP_REGISTRY_INVALID", "NO_SUPPORTED_LIVE_TOOLS", "AI_MODEL_NOT_CONFIGURED", "PROVIDER_NOT_CONFIGURED", "MISSING_MARKET_CALL_BUDGET", "APPROVED_SCHEMA_CHANGED", "PENDING_TOOL_CALL_MISMATCH", "INVALID_ASIN", "REQUIRED_PROVIDER_NOT_CONNECTED", "RESEARCH_REPORT_METADATA_FAILED", "RESEARCH_REPORT_UNAVAILABLE", "RESEARCH_REPORT_INTEGRITY_FAILED", "EXPLICIT_RESEARCH_MODE_REQUIRED", "INVALID_RESEARCH_REQUEST", "INVALID_ERP_CREDENTIAL_ID"]);
  known.add("LIVE_BUDGET_REVIEW_REQUIRED"); known.add("RESEARCH_STAGE_REPORT_UNAVAILABLE"); known.add("RESEARCH_EVIDENCE_NOT_FOUND");
  known.add("RESEARCH_RUNTIME_AI_PERMISSION_REQUIRED"); known.add("INVALID_RESEARCH_AI_SOURCE");
  const invalidInput = new Set(["EXPLICIT_RESEARCH_MODE_REQUIRED", "INVALID_RESEARCH_REQUEST", "INVALID_ERP_CREDENTIAL_ID", "INVALID_ASIN", "MISSING_MARKET_CALL_BUDGET", "INVALID_RESEARCH_AI_SOURCE"]);
  return NextResponse.json({ error: known.has(code) ? code : "RESEARCH_UNAVAILABLE_OR_INVALID_REQUEST" }, { status: invalidInput.has(code) ? 400 : ["RESEARCH_NOT_FOUND", "RESEARCH_EVIDENCE_NOT_FOUND"].includes(code) ? 404 : ["RESEARCH_SCOPE_DENIED", "RESEARCH_RUNTIME_AI_PERMISSION_REQUIRED"].includes(code) ? 403 : known.has(code) ? 409 : 400 });
}
