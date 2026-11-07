import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { discoverResearchTools, getResearchAvailability, installedResearchSkills, researchAccess, researchError, researchNamespace } from "@/lib/selection-research/server";
import { parseResearchInput } from "@/lib/selection-research/preflight";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const access = await researchAccess(request, "view", { mode: "fixture" });
    if (!access.ok) return access.response;
    const [runs, availability] = await Promise.all([
      prisma.agentExecution.findMany({ where: { organizationId: access.scope.organizationId, workspaceId: access.scope.workspaceId, requestedByUserId: access.scope.ownerId, context: { path: ["namespace"], equals: researchNamespace } }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, status: true, input: true, updatedAt: true } }),
      getResearchAvailability(request),
    ]);
    if (!availability.ok) return availability.response;
    return NextResponse.json({ runs, availability: { sellerSprite: availability.sellerSprite, ai: availability.ai, xiyou: availability.xiyou, erp: availability.erp },
      message: "Lili 沿用当前 ERP 登录。真实运行读取当前用户和工作区已有 SellerSprite MCP/AI 配置；西柚未接入时显示缺失。每次付费市场请求都需人工确认。" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchError(error); }
}
export async function POST(request: Request) {
  try {
    const body = await boundedJsonObject(request, 64_000);
    const input = parseResearchInput(body);
    const { mode, asin, requirement, marketplace, erpCredentialId, aiConfigSource } = input;
    const access = await researchAccess(request, "create", { ...body, mode, erpCredentialId }); if (!access.ok) return access.response;
    if (mode === "fixture") {
      if (!access.fixture) throw new Error("RESEARCH_MODE_MISMATCH");
      const skills = await installedResearchSkills();
      const run = await access.engine.create({ requirement, marketplace, skills, policies: access.fixture.policies, limits: {} });
      return NextResponse.json({ run }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (!access.transport || !access.sellerSettings?.enabled || !access.sellerSettings.apiKey || !access.sellerSettings.serverUrl) throw new Error("SELLERSPRITE_MCP_NOT_CONFIGURED");
    if (!access.aiSettings?.apiKey) throw new Error("AI_MODEL_NOT_CONFIGURED");
    const maxCalls = input.maxMarketCalls!;
    const providers = await access.runtimeTools!.discover();
    const unavailable = providers.providers.filter(provider => provider.status !== "connected" || !providers.tools.some(tool => tool.provider === provider.provider && tool.availability === "available"));
    if (unavailable.length) return NextResponse.json({ error: "REQUIRED_PROVIDER_NOT_CONNECTED", providers: unavailable }, { status: 409 });
    const skills = await installedResearchSkills();
    const discovery = await discoverResearchTools(access.transport, providers.tools.filter(tool => tool.availability === "available"));
    if (!discovery.registry.length) throw new Error("NO_SUPPORTED_LIVE_TOOLS");
    const run = await access.engine.create({ requirement, marketplace, skills, asin, aiConfigSource, aiModel: { provider: access.aiSettings.provider, model: access.aiSettings.model }, erpCredentialId: access.runtimeTools?.erpCredentialId, requiredProviders: ["erp", "sellersprite", "xiyou"], policies: discovery.policies, limits: { sellersprite: maxCalls, xiyou: maxCalls }, registry: discovery.registry });
    return NextResponse.json({ run, discovery: {
      registeredReadTools: discovery.registry.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      missingCanonicalTools: discovery.missing, providers: providers.providers,
      charges: "Provider descriptions do not expose a reliable fixed price per request. The project limits call count; each exact request requires approval and actual charge reconciliation.",
    } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchError(error); }
}
