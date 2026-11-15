import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { getSellfoxCredentialStatus } from "@/lib/sellfox/credential-store";
import {
  sellfoxEndpointOverview, validateSellfoxEndpointInput, planSellfoxFullSync,
} from "@/lib/sellfox/sync-orchestrator";
import { sellfoxEndpointCandidates } from "@/lib/sellfox/endpoint-candidates";
import { seedSellfoxKnownEndpoints } from "@/lib/sellfox/known-endpoints";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  // 候选只作参考：真实路径来自 data-plan.ts，参数契约未联调前不自动注册、不启用。
  return NextResponse.json({ endpoints: await sellfoxEndpointOverview(scope), candidates: sellfoxEndpointCandidates() });
}

/** 新增或编辑一条 API 端点配置；保存后 worker 自动纳入全量计划，无需脚本。 */
export async function POST(request: Request) {
  const permission = await requireApiPermission("sellfox", "create", request);
  if (!permission.ok) return permission.response;
  if (process.env.QUEUE_DRIVER !== "redis") return NextResponse.json({ error: "赛狐异步同步 Worker 未启用。" }, { status: 503 });
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  if (!(await getSellfoxCredentialStatus(scope)).configured) return NextResponse.json({ error: "服务端赛狐凭据未配置。" }, { status: 503 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "请求体无效。" }, { status: 400 });
  // 一键登记本地已文档化域（财务 V2 / FBM 等）为默认停用的通用端点；不触发校验，独立分支。
  if (body.seedKnown === true) {
    const result = await seedSellfoxKnownEndpoints(scope);
    return NextResponse.json({ ok: true, seed: result, endpoints: await sellfoxEndpointOverview(scope) });
  }
  let input;
  try { input = validateSellfoxEndpointInput(body); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "配置无效。" }, { status: 400 }); }
  const data = { ...input, label: input.label, updatedAt: new Date() };
  await prisma.sellfoxApiEndpoint.upsert({
    where: { organizationId_workspaceId_code: { ...scope, code: input.code } },
    create: { id: `sellfox-endpoint-${scope.organizationId}-${scope.workspaceId}-${input.code}`, ...scope, ...data },
    update: data,
  });
  return NextResponse.json({ ok: true, endpoints: await sellfoxEndpointOverview(scope) });
}

/** 启停 / 重置自动回填游标 / 只对该端点发起全量。 */
export async function PATCH(request: Request) {
  const permission = await requireApiPermission("sellfox", "create", request);
  if (!permission.ok) return permission.response;
  const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
  const body = await request.json().catch(() => null) as { code?: unknown; enabled?: unknown; action?: unknown } | null;
  if (typeof body?.code !== "string" || !body.code.trim()) return NextResponse.json({ error: "缺少端点 code。" }, { status: 400 });
  const code = body.code.trim();
  const endpoint = await prisma.sellfoxApiEndpoint.findUnique({ where: { organizationId_workspaceId_code: { ...scope, code } }, select: { id: true } });
  if (!endpoint) return NextResponse.json({ error: "端点不存在。" }, { status: 404 });
  if (body.action === "reset_cursor") {
    await prisma.sellfoxApiEndpoint.update({ where: { id: endpoint.id }, data: { cursorDate: null, lastPlannedAt: null } });
  } else if (body.action === "full_sync") {
    const plan = await planSellfoxFullSync({ ...scope, userId: permission.user.id }, { endpointCodes: [code], resources: [] });
    return NextResponse.json({ ok: true, plan, endpoints: await sellfoxEndpointOverview(scope) });
  } else if (typeof body.enabled === "boolean") {
    await prisma.sellfoxApiEndpoint.update({ where: { id: endpoint.id }, data: { enabled: body.enabled } });
  } else return NextResponse.json({ error: "无效的端点操作。" }, { status: 400 });
  return NextResponse.json({ ok: true, endpoints: await sellfoxEndpointOverview(scope) });
}
