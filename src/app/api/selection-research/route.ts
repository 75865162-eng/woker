import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { discoverResearchTools, getResearchAvailability, installedResearchSkills, researchAccess, researchError, researchNamespace } from "@/lib/selection-research/server";

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
    return NextResponse.json({ runs, availability: { sellerSprite: availability.sellerSprite, ai: availability.ai, xiyou: availability.xiyou },
      message: "Lili 沿用当前 ERP 登录。真实运行读取当前用户和工作区已有 SellerSprite MCP/AI 配置；西柚未接入时显示缺失。每次付费市场请求都需人工确认。" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchError(error); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const mode = body.mode === "live" ? "live" : "fixture";
    const access = await researchAccess(request, "create", { ...body, mode }); if (!access.ok) return access.response;
    if (typeof body.requirement !== "string" || typeof body.marketplace !== "string") return NextResponse.json({ error: "INVALID_RESEARCH_REQUEST" }, { status: 400 });
    const skills = await installedResearchSkills();
    if (mode === "fixture") {
      if (!access.fixture) throw new Error("RESEARCH_MODE_MISMATCH");
      const run = await access.engine.create({ requirement: body.requirement, marketplace: body.marketplace, skills, policies: access.fixture.policies, limits: {} });
      return NextResponse.json({ run }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
    if (!access.transport || !access.sellerSettings?.enabled || !access.sellerSettings.apiKey || !access.sellerSettings.serverUrl) throw new Error("SELLERSPRITE_MCP_NOT_CONFIGURED");
    if (!access.aiSettings?.apiKey) throw new Error("AI_MODEL_NOT_CONFIGURED");
    const maxCalls = Number(body.maxMarketCalls);
    if (!Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 30) throw new Error("MISSING_MARKET_CALL_BUDGET");
    const discovery = await discoverResearchTools(access.transport);
    if (!discovery.registry.length) throw new Error("NO_SUPPORTED_LIVE_TOOLS");
    const run = await access.engine.create({ requirement: body.requirement, marketplace: body.marketplace, skills, policies: discovery.policies, limits: { sellersprite: maxCalls }, registry: discovery.registry });
    return NextResponse.json({ run, discovery: {
      registeredReadTools: discovery.registry.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      missingCanonicalTools: discovery.missing, unavailableProviders: { xiyou: "No ERP credential or executor; not called." },
      charges: "Provider descriptions do not expose a reliable fixed price per request. The project limits call count; each exact request requires approval and actual charge reconciliation.",
    } }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchError(error); }
}
