import { NextResponse } from "next/server";
import { actOnFbaLocalPlan, createFbaLocalPlan, queryFbaLocalPlans } from "@/lib/fba-local/service";
import { readJson, wmsErrorResponse, wmsRequestScope } from "../wms/_shared";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  try {
    const auth = await wmsRequestScope(request);
    if ("response" in auth) return auth.response;
    return NextResponse.json(await queryFbaLocalPlans(auth.scope, new URL(request.url).searchParams), { headers });
  } catch (error) { return wmsErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const auth = await wmsRequestScope(request);
    if ("response" in auth) return auth.response;
    const item = body.action ? await actOnFbaLocalPlan(auth.scope, body) : await createFbaLocalPlan(auth.scope, body);
    return NextResponse.json({ item }, { headers });
  } catch (error) { return wmsErrorResponse(error); }
}
