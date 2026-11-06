import { homedir } from "node:os";
import path from "node:path";
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
import { createSellerSpriteResearchTransport, sellerSpritePolicy } from "./seller-transport";
import { loadResearchSkills } from "./skills";
import type { ToolPolicy, ToolDefinition } from "./types";
import { NextResponse } from "next/server";

export const researchNamespace = "selection-research-v1";
export async function researchAccess(request: Request, action: PermissionAction, body: Record<string, unknown> = {}) {
  const permission = await requireApiPermission("agents", action, request);
  if (!permission.ok) return permission;
  const workspaceId = workspaceScopeFromRequest(request, body).workspaceId;
  if (!await assertWorkspaceAccess(permission.user.organizationId, workspaceId)) return { ok: false as const, response: NextResponse.json({ error: "Forbidden workspace." }, { status: 403 }) };
  const scope = { organizationId: permission.user.organizationId, workspaceId, ownerId: permission.user.id };
  const fixture = researchFixture();
  const repository = prismaResearchRepository();
  let mode = body.mode === "live" ? "live" as const : "fixture" as const;
  if (typeof body.runId === "string") {
    try { mode = (await repository.read(body.runId, scope)).run.mode; }
    catch { return { ok: false as const, response: NextResponse.json({ error: "Research not found." }, { status: 404 }) }; }
  }
  if (mode === "fixture") {
    const engine = new ResearchEngine(new LeaseResearchStore(repository, scope), scope, fixture.transport, fixture.agent, { mode });
    return { ok: true as const, scope, engine, fixture };
  }
  const sellerSettings = await getSellerSpriteMcpSettings(permission.user, { workspaceId, accountId: "", marketplace: "" });
  const aiSettings = await resolveUserAiTextSettings(permission.user, { workspaceId, accountId: "", marketplace: "" });
  const transport = createSellerSpriteResearchTransport(sellerSettings);
  const agent = createResearchAiAgent(aiSettings);
  const engine = new ResearchEngine(new LeaseResearchStore(repository, scope), scope, transport, agent, {
    mode, authorizeLive: async (run) => run.scope.organizationId === permission.user.organizationId && run.scope.workspaceId === workspaceId && run.scope.ownerId === permission.user.id && sellerSettings.enabled && Boolean(sellerSettings.apiKey && sellerSettings.serverUrl && aiSettings.apiKey),
  });
  return { ok: true as const, scope, engine, sellerSettings, aiSettings, transport };
}

export async function getResearchAvailability(request: Request) {
  const access = await researchAccess(request, "view", { mode: "fixture" });
  if (!access.ok) return access;
  const user = (await requireApiPermission("agents", "view", request));
  if (!user.ok) return user;
  const workspaceId = access.scope.workspaceId;
  const seller = await getSellerSpriteMcpSettings(user.user, { workspaceId, accountId: "", marketplace: "" });
  const ai = await resolveUserAiTextSettings(user.user, { workspaceId, accountId: "", marketplace: "" });
  return { ok: true as const, scope: access.scope, sellerSprite: seller.enabled && Boolean(seller.apiKey && seller.serverUrl) ? "configured_runtime_registry_not_yet_checked" : "missing_existing_provider_configuration",
    ai: ai.apiKey ? "configured" : "missing_existing_model_configuration", xiyou: "unavailable_no_ERP_provider_adapter" };
}
export async function discoverResearchTools(transport: { listTools(): Promise<ToolDefinition[]> }) {
  const registered = await transport.listTools();
  const usable: ToolDefinition[] = [];
  const policies: Record<string, ToolPolicy> = {};
  const supported = new Set<string>();
  for (const tool of registered) {
    const policy = sellerSpritePolicy(tool);
    if (!policy || tool.annotations?.readOnlyHint === false) continue;
    usable.push(tool); policies[tool.name] = policy; supported.add(canonicalResearchTool(tool.name)!);
  }
  const missing = [...READ_TOOLS].filter((name) => !supported.has(name));
  return { registry: usable, policies, missing };
}
export async function installedResearchSkills() { return loadResearchSkills(process.env.SELECTION_SKILL_ROOT || path.join(homedir(), ".codex", "skills")); }
export function researchError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  const known = new Set(["RESEARCH_NOT_FOUND", "RESEARCH_SCOPE_DENIED", "RESEARCH_BUSY", "STALE_OR_MISSING_GATE", "INVALID_CANDIDATE", "DECISION_DOES_NOT_MATCH_GATE", "REPORT_REQUIRES_BOTH_HUMAN_GATES", "RESEARCH_MODE_MISMATCH", "BUDGET_MUST_INCREASE", "INVALID_BILLING_RECONCILIATION", "TERMINAL_RUN", "EXPLICIT_RECOVERY_REQUIRED", "RECOVERY_NOT_APPLICABLE", "SELLERSPRITE_MCP_NOT_CONFIGURED", "SELLERSPRITE_MCP_TOOL_NOT_FOUND", "SELLERSPRITE_MCP_REGISTRY_INVALID", "NO_SUPPORTED_LIVE_TOOLS", "AI_MODEL_NOT_CONFIGURED", "PROVIDER_NOT_CONFIGURED", "MISSING_MARKET_CALL_BUDGET", "APPROVED_SCHEMA_CHANGED", "PENDING_TOOL_CALL_MISMATCH"]);
  return NextResponse.json({ error: known.has(code) ? code : "RESEARCH_UNAVAILABLE_OR_INVALID_REQUEST" }, { status: code === "RESEARCH_NOT_FOUND" ? 404 : code === "RESEARCH_SCOPE_DENIED" ? 403 : known.has(code) ? 409 : 400 });
}
