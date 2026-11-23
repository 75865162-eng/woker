import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { WmsError } from "@/lib/wms/contracts";
import { readSettlementSkuPivot } from "@/lib/amazon-sync/settlement-sku-pivot";
import { readAdSpendByAsin, buildProfitSkuRows, buildProfitStoreRows, PROFIT_BASIS } from "@/lib/amazon-sync/profit-report";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireApiPermission("operations", "view", request);
  if (!auth.ok) return auth.response;
  try {
    const wms = { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id };
    const amazonScope = { organizationId: wms.organizationId, workspaceId: wms.workspaceId };
    const params = new URL(request.url).searchParams;
    const [pivot, adSpend] = await Promise.all([
      readSettlementSkuPivot(wms, params),
      readAdSpendByAsin(amazonScope),
    ]);
    const skuRows = buildProfitSkuRows(pivot.rows, adSpend);
    const settlementId = params.get("settlementId")?.trim().slice(0, 200) || "全部结算批次";
    const storeRows = buildProfitStoreRows(skuRows, settlementId);
    return NextResponse.json({
      skuRows, storeRows,
      basis: PROFIT_BASIS,
      asOf: pivot.asOf,
      truncated: pivot.truncated,
      sources: { settlementPivot: "PUBLISHED_ATTRIBUTED_SETTLEMENT_ROWS", adSpend: "AmazonAdsReportFact(PUBLISHED,SUCCEEDED)", pending: ["采购成本", "税费", "本地费用"] },
    }, { headers });
  } catch (error) {
    if (error instanceof WmsError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
    console.error("[operations.profit-report]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "利润报表暂不可用。" }, { status: 500, headers });
  }
}
