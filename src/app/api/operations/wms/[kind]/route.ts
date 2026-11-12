import {updateOverseasTransport} from '@/lib/wms/overseas-service';
import {updateCatalogDetails} from '@/lib/wms/catalog-details-service';
import { NextResponse } from "next/server";
import { createWmsResource, setWmsResourceEnabled, type CatalogKind } from "@/lib/wms/catalog-service";
import { queryKinds, queryWms } from "@/lib/wms/query-service";
import { updateReceiptDraft } from "@/lib/wms/receipt-draft-service";
import { cancelOutbound, updateOutboundDraft } from "@/lib/wms/outbound-draft-service";
import { readJson, wmsErrorResponse, wmsRequestScope } from "../_shared";

const catalogKinds: CatalogKind[] = ["cost-rules", "overseas-transfers", "consumables","warehouse-types", "warehouse-addresses", "transfer-orders", "warehouses", "areas", "locations", "lots", "receipts", "stocktakes", "outbounds"];
type RouteContext = { params: Promise<{ kind: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { kind } = await context.params;
  if (!queryKinds.includes(kind as typeof queryKinds[number])) return NextResponse.json({ error: "未知 WMS 查询类型。" }, { status: 404 });
  const auth = await wmsRequestScope(request);
  if ("response" in auth) return auth.response;
  try {
    const result = await queryWms(auth.scope, kind as typeof queryKinds[number], new URL(request.url).searchParams);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return wmsErrorResponse(error); }
}

export async function POST(request: Request, context: RouteContext) {
  const { kind } = await context.params;
  if (!catalogKinds.includes(kind as CatalogKind)) return NextResponse.json({ error: "此类型不支持创建。" }, { status: 404 });
  try {
    const body = await readJson(request);
    const auth = await wmsRequestScope(request, body);
    if ("response" in auth) return auth.response;
    const { workspaceId: _workspaceId, ...resource } = body;
    void _workspaceId;
    const result = await createWmsResource(auth.scope, kind as CatalogKind, resource);
    return NextResponse.json({ item: result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return wmsErrorResponse(error); }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { kind } = await context.params;
  if (!["lots", "overseas-transfers", "warehouse-addresses", "warehouses", "areas", "locations", "receipts", "outbounds"].includes(kind)) return NextResponse.json({ error: "此类型不支持修改。" }, { status: 404 });
  try {
    const body = await readJson(request);
    const auth = await wmsRequestScope(request, body);
    if ("response" in auth) return auth.response;
    const { workspaceId: _workspaceId, ...resource } = body;
    void _workspaceId;
    if (["lots","warehouse-addresses"].includes(kind) && resource.action !== "PROFILE") throw new Error("地址只支持 PROFILE 更新。");
    const result = kind === "overseas-transfers" ? await updateOverseasTransport(auth.scope,resource) : ((kind === "lots" || kind === "warehouses" || kind === "locations" || kind === "warehouse-addresses") && resource.action === "PROFILE") ? await updateCatalogDetails(auth.scope,kind,resource) : kind === "receipts" ? await updateReceiptDraft(auth.scope, resource) : kind === "outbounds" ? resource.action === "CANCEL" ? await cancelOutbound(auth.scope, resource) : await updateOutboundDraft(auth.scope, resource) : await setWmsResourceEnabled(auth.scope, kind as "warehouses" | "areas" | "locations", resource);
    return NextResponse.json({ item: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return wmsErrorResponse(error); }
}
