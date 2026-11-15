import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { WmsError } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';
import {
  querySettlementAllocations,
  stageSettlementAllocation,
  publishSettlementAllocation,
  reverseSettlementAllocation,
} from '@/lib/amazon-sync/settlement-allocation-service';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

function errorResponse(error: unknown) {
  if (error instanceof WmsError || error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ error: error.code === 'P2002' ? '相同结算输入的批次已存在，请刷新后重试。' : '结算分摊记录冲突，请刷新后重试。' }, { status: 409, headers });
  // 纯函数的对账失败/非法金额属于输入问题，直接回传原因，便于定位，不伪装成服务故障。
  if (error instanceof Error && /结算分摊对账失败|结算行金额缺失|整批拒绝|settlement-id|站点归属|币种缺失|不能为空|长度须为/.test(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 422, headers });
  }
  console.error('[operations.settlement-allocations]', error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  return NextResponse.json({ error: '结算分摊服务暂不可用。' }, { status: 500, headers });
}

export async function GET(request: Request) {
  const auth = await requireApiPermission('operations', 'view', request);
  if (!auth.ok) return auth.response;
  try {
    const scope = { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id };
    return NextResponse.json(await querySettlementAllocations(scope, new URL(request.url).searchParams), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body');
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: '请求内容无效。' }, { status: 400, headers }); }
  const action = String(body.action ?? '');
  const permission = action === 'stage' ? 'create' : action === 'publish' || action === 'reverse' ? 'approve' : null;
  if (!permission) return NextResponse.json({ error: '未知的分摊操作。' }, { status: 400, headers });
  const auth = await requireApiPermission('operations', permission, request);
  if (!auth.ok) return auth.response;
  try {
    const scope = { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId, actorUserId: auth.user.id };
    const result = action === 'stage' ? await stageSettlementAllocation(scope, body)
      : action === 'publish' ? await publishSettlementAllocation(scope, body)
      : await reverseSettlementAllocation(scope, body);
    return NextResponse.json(result, { status: action === 'stage' ? 201 : 200, headers });
  } catch (error) { return errorResponse(error); }
}
