import { NextResponse } from "next/server";
import { executeWmsCommand } from "@/lib/wms/application-service";
import { parseWmsCommand, requireText } from "@/lib/wms/rules";
import { readJson, wmsErrorResponse, wmsRequestScope } from "../_shared";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const auth = await wmsRequestScope(request, body);
    if ("response" in auth) return auth.response;
    const { approvalId: rawApprovalId, ...commandBody } = body;
    const command = parseWmsCommand(commandBody);
    const approvalId = rawApprovalId ? requireText(rawApprovalId, "审批 ID") : undefined;
    const result = await executeWmsCommand(auth.scope, command, approvalId);
    return NextResponse.json({ item: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return wmsErrorResponse(error); }
}
