import { NextResponse } from "next/server";
import { assertAmazonCloudExecution, AmazonCloudExecutionError } from "@/lib/amazon/execution-role";
import { AmazonCloudRelayError, verifyCloudRelayEnvelope } from "@/lib/amazon/cloud-relay-protocol";
import { executeCloudRelay } from "@/lib/amazon-sync/cloud-execution-server";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { SyncInputError } from "@/lib/amazon-sync/policy";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
export async function POST(request: Request) {
  try {
    assertAmazonCloudExecution();
    const body = await boundedJsonObject(request, 16_384);
    const envelope = verifyCloudRelayEnvelope(body, request.headers.get("x-amazon-cloud-signature"));
    return NextResponse.json(await executeCloudRelay(envelope), { headers });
  } catch (error) {
    const known = error instanceof SyncInputError;
    return NextResponse.json({ error: known ? error.message : "云端执行请求失败，请核对审批与任务状态。", ...(error instanceof AmazonCloudRelayError || error instanceof AmazonCloudExecutionError ? { code: error.code } : {}) }, { status: known ? error.status : 500, headers });
  }
}
