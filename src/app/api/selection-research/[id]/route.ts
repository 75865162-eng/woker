import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { NextResponse } from "next/server";
import { researchAccess, researchError } from "@/lib/selection-research/server";
import { executeResearchCommand } from "@/lib/selection-research/http";
import { renderResearchReport } from "@/lib/selection-research/report";
import { saveResearchReport } from "@/lib/selection-research/prisma-repository";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const id = (await context.params).id;
    const access = await researchAccess(request, "view", { runId: id }); if (!access.ok) return access.response;
    return NextResponse.json({ run: await access.engine.inspect(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const body = await boundedJsonObject(request, 64_000);
    const action = body.operation === "decide" ? "approve" : body.operation === "export" ? "export" : "edit";
    const id = (await context.params).id;
    const access = await researchAccess(request, action, { ...body, runId: id }); if (!access.ok) return access.response;
    if (body.operation === "export") {
      return NextResponse.json(await access.engine.saveReport(id, (run) => saveResearchReport(run, renderResearchReport(run))), { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ run: await executeResearchCommand(access.engine, id, body, action === "approve") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return researchError(error); }
}
