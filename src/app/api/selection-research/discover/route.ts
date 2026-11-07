import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { NextResponse } from "next/server";
import { researchAccess, researchError, getResearchAvailability, installedResearchSkills } from "@/lib/selection-research/server";
import { rejectCredentials } from "@/lib/selection-research/schema";
import { runtimeToolsForUser } from "@/lib/lili/runtime-server";
import { researchReadiness } from "@/lib/selection-research/preflight";

export const runtime = "nodejs";
/** Explicit metadata-only discovery: no research record, model request or tools/call. */
export async function POST(request: Request) {
  try {
    const body = await boundedJsonObject(request, 64_000);
    const access = await researchAccess(request, "view", { ...body, mode: "fixture" });
    if (!access.ok) return access.response;
    const runtimeTools = await runtimeToolsForUser({ id: access.scope.ownerId, organizationId: access.scope.organizationId }, request, body);
    const [result, availability, skills] = await Promise.all([
      runtimeTools.discover(), getResearchAvailability(request, body).catch(() => undefined), installedResearchSkills().catch(() => undefined),
    ]);
    if (availability && !availability.ok) return availability.response;
    rejectCredentials(result);
    const readiness = researchReadiness({ ...result, ai: availability?.ok ? availability.ai : "model_configuration_unavailable", skills, request: body });
    return NextResponse.json({ ...result, readiness, scope: { workspaceId: access.scope.workspaceId }, toolsCallCount: 0, aiRequestCount: 0, persisted: false }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchError(error); }
}
