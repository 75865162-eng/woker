import { NextResponse } from "next/server";
import { decideApproval, requestApproval } from "@/lib/wms/approvals";
import { normalizeWmsPayload, requireRevision, requireText, strictKeys } from "@/lib/wms/rules";
import { readJson, wmsErrorResponse, wmsRequestScope } from "../_shared";

export async function GET(request: Request) {
  const auth = await wmsRequestScope(request);
  if ("response" in auth) return auth.response;
  try {
    const result = await import("@/lib/wms/query-service").then(({ queryWms }) => queryWms(auth.scope, "approvals", new URL(request.url).searchParams));
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return wmsErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const auth = await wmsRequestScope(request, body);
    if ("response" in auth) return auth.response;
    if (body.decision === "APPROVE" || body.decision === "REJECT") {
      strictKeys(body, ["workspaceId", "approvalId", "revision", "decision"]);
      const result = await decideApproval(auth.scope, requireText(body.approvalId, "审批 ID"), requireRevision(body.revision), body.decision === "APPROVE");
      return NextResponse.json({ item: result }, { headers: { "Cache-Control": "no-store" } });
    }
    strictKeys(body, ["workspaceId", "aggregateId", "expectedRevision", "idempotencyKey", "payload"]);
    const payload = normalizeWmsPayload(body.payload);
    if (typeof body.idempotencyKey !== "string") throw Object.assign(new Error("幂等键缺失。"), { status: 400 });
    const command = {
      workspaceId: auth.scope.workspaceId,
      aggregateId: requireText(body.aggregateId, "业务单据 ID"),
      expectedRevision: requireRevision(body.expectedRevision),
      idempotencyKey: requireText(body.idempotencyKey, "幂等键", 64),
      payload,
    };
    const result = await requestApproval(auth.scope, command);
    return NextResponse.json({ item: result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return wmsErrorResponse(error); }
}
