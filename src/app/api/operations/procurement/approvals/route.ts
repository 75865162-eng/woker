import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { decidePurchaseOrderApproval, decidePurchasePaymentApproval } from "@/lib/procurement/order-service";
import { decidePurchaseRefundApproval } from "@/lib/procurement/refund-service";
import { WmsError } from "@/lib/wms/contracts";
import { WmsInputError } from "@/lib/wms/rules";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await requireApiPermission("operations", "approve", request);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const scope = { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id };
    const { kind, ...decisionBody } = body;
    if (kind !== undefined && kind !== "PAYMENT" && kind !== "PAYMENT_REFUND" && kind !== "ORDER") return NextResponse.json({ error: "审批类型无效。" }, { status: 400 });
    const result = kind === "PAYMENT" ? await decidePurchasePaymentApproval(scope, decisionBody) : kind === "PAYMENT_REFUND" ? await decidePurchaseRefundApproval(scope, decisionBody) : await decidePurchaseOrderApproval(scope, decisionBody);
    return NextResponse.json({ approval: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WmsError || error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[operations.procurement.approvals]", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "采购审批暂不可用。" }, { status: 500 });
  }
}
