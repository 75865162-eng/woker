import { NextResponse } from "next/server";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { exchangePairing } from "@/lib/lili/device-pairing";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
export async function POST(request: Request) {
 try {
  const body = await boundedJsonObject(request, 2048);
  if (Object.keys(body).some(key => !["pairingId", "code", "deviceName"].includes(key))) throw new SyncInputError("参数无效。", 400);
  const result = await exchangePairing(String(body.pairingId ?? ""), String(body.code ?? ""), String(body.deviceName ?? ""));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
 } catch (error) { return NextResponse.json({ error: error instanceof SyncInputError ? error.message : "配对暂不可用。" }, { status: error instanceof SyncInputError ? error.status : 503, headers: { "Cache-Control": "no-store" } }); }
}
