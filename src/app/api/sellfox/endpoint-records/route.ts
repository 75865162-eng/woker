import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

/**
 * 泛化端点同步的原始行承接入口（只读）。
 *
 * SellfoxApiRecord.payload 保存赛狐接口原始响应行，不猜字段、不补零、不做换算。
 * 这里只做租户围栏 + 端点归属校验，按物理行的真实字段返回，不把未接入端点伪装成空数据。
 */
export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;

  const url = new URL(request.url);
  const code = url.searchParams.get("code") ?? "";
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(code)) {
    return NextResponse.json({ error: "端点 code 无效。" }, { status: 400 });
  }
  const period = url.searchParams.get("period") ?? "";
  const storeId = url.searchParams.get("storeId") ?? "";
  if (period.length > 64 || storeId.length > 120) {
    return NextResponse.json({ error: "筛选参数过长。" }, { status: 400 });
  }
  const page = clamp(Number(url.searchParams.get("page")), 1, 10_000, 1);
  const pageSize = clamp(Number(url.searchParams.get("pageSize")), 1, 200, 20);

  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  const endpoint = await prisma.sellfoxApiEndpoint.findUnique({
    where: { organizationId_workspaceId_code: { ...scope, code } },
    select: { code: true, label: true, path: true, rowsPath: true, scopeMode: true, dateMode: true },
  });
  if (!endpoint) return NextResponse.json({ error: "该租户下不存在此端点配置。" }, { status: 404 });

  const where = {
    ...scope, endpointCode: code,
    ...(period ? { period } : {}),
    ...(storeId ? { storeId } : {}),
  };
  const [total, records] = await Promise.all([
    prisma.sellfoxApiRecord.count({ where }),
    prisma.sellfoxApiRecord.findMany({
      where, orderBy: [{ syncedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, externalId: true, scopeKey: true, period: true, storeId: true, syncedAt: true, payload: true },
    }),
  ]);
  return NextResponse.json({
    endpoint,
    rows: records,
    total,
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize), hasNext: page * pageSize < total },
    disclosure: {
      source: "赛狐 Open API 原始响应（经泛化端点同步落库）",
      dataClass: "RAW_API_RESPONSE_ROWS",
      warnings: [
        "payload 是接口原始行，未知字段原样保留，不猜字段、不补零、不做金额换算。",
        "数值与金额精度以 JSONB 落库时为准；缺失字段不代表业务为零。",
        "同一业务键重复同步会 upsert 覆盖，此表不保留历史版本。",
        "与赛狐已发布快照口径、Amazon 承接池数据均不可直接相加混算。",
      ],
    },
  });
}

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
