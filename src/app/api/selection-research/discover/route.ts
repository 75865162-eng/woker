import { NextResponse } from "next/server";
import { discoverResearchTools, researchAccess, researchError } from "@/lib/selection-research/server";
import { rejectCredentials } from "@/lib/selection-research/schema";

export const runtime = "nodejs";
/** Explicit metadata-only discovery: no research record, model request or tools/call. */
export async function POST(request: Request) {
  try {
    const access = await researchAccess(request, "view", { mode: "live" });
    if (!access.ok) return access.response;
    if (!access.transport || !access.sellerSettings?.enabled || !access.sellerSettings.apiKey) throw new Error("SELLERSPRITE_MCP_NOT_CONFIGURED");
    const result = await discoverResearchTools(access.transport);
    rejectCredentials(result.registry);
    return NextResponse.json({ discoveredAt: new Date().toISOString(), scope: { workspaceId: access.scope.workspaceId }, tools: result.registry,
      missingCanonicalTools: result.missing, xiyou: "unavailable_no_ERP_provider_adapter", toolsCallCount: 0, aiRequestCount: 0, persisted: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchError(error); }
}
