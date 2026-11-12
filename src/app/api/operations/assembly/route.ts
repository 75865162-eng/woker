import { NextResponse } from "next/server";
import {
  cancelAssemblyOrder,
  createAssemblyOrder,
  createBom,
  queryAssemblyOptions,
  queryAssemblyOrders,
  queryBoms,
  setBomEnabled,
} from "@/lib/wms/assembly-service";
import { readJson, wmsErrorResponse, wmsRequestScope } from "../wms/_shared";

const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await wmsRequestScope(request);
  if ("response" in auth) return auth.response;
  try {
    const params = new URL(request.url).searchParams;
    const kind = params.get("kind") ?? "orders";
    if (kind === "boms") return NextResponse.json(await queryBoms(auth.scope, params), { headers });
    if (kind === "orders") return NextResponse.json(await queryAssemblyOrders(auth.scope, params), { headers });
    if (kind === "options") return NextResponse.json(await queryAssemblyOptions(auth.scope), { headers });
    return NextResponse.json({ error: "未知查询类型。" }, { status: 404, headers });
  } catch (error) {
    return wmsErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const auth = await wmsRequestScope(request, body);
    if ("response" in auth) return auth.response;
    const { kind, ...resource } = body;
    if (kind === "bom") return NextResponse.json({ item: await createBom(auth.scope, resource) }, { status: 201, headers });
    if (kind === "order") return NextResponse.json({ item: await createAssemblyOrder(auth.scope, resource) }, { status: 201, headers });
    return NextResponse.json({ error: "未知创建类型。" }, { status: 400, headers });
  } catch (error) {
    return wmsErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await readJson(request);
    const auth = await wmsRequestScope(request, body);
    if ("response" in auth) return auth.response;
    const { kind, ...resource } = body;
    if (kind === "bom") return NextResponse.json({ item: await setBomEnabled(auth.scope, resource) }, { headers });
    if (kind === "order") return NextResponse.json({ item: await cancelAssemblyOrder(auth.scope, resource) }, { headers });
    return NextResponse.json({ error: "未知修改类型。" }, { status: 400, headers });
  } catch (error) {
    return wmsErrorResponse(error);
  }
}
