import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { normalizeSyncIdempotencyKey, requestAmazonSync } from "@/lib/operations/readiness";
import { isAmazonSyncResource } from "@/lib/operations/types";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const permission = await requireApiPermission("operations", "create", request);
    if (!permission.ok) return permission.response;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const resource = body.resource ?? "readiness";
    if (!isAmazonSyncResource(resource)) {
      return NextResponse.json({ error: "不支持的同步数据域。" }, { status: 400 });
    }

    const run = await requestAmazonSync({
      user: permission.user,
      scope: workspaceScopeFromRequest(request, body),
      resource,
      idempotencyKey: normalizeSyncIdempotencyKey(body.idempotencyKey),
    });
    return NextResponse.json({ run, error: run.error }, { status: run.status === "QUEUED" ? 202 : run.status === "BLOCKED" ? 409 : 200 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步请求创建失败。" }, { status: 500 });
  }
}
