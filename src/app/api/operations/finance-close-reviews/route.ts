import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { queryCloseReviews, mutateCloseReview } from '@/lib/finance/close-service';
import { WmsError } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';
import { FinanceRuleError } from '@/lib/finance/rules';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
function errorResponse(error: unknown) {
  if (error instanceof WmsError || error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof FinanceRuleError) return NextResponse.json({ error: error.message }, { status: 422 });
  if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ error: error.code === 'P2002' ? '账套编码、期间编码、科目编码或凭证来源已存在。' : '总账记录冲突，请刷新后重试。' }, { status: 409 });
  console.error('[operations.finance-ledger]', { name: error instanceof Error ? error.name : 'UnknownError' });
  return NextResponse.json({ error: '总账服务暂不可用。' }, { status: 500 });
}

export async function GET(request: Request) {
  const auth = await requireApiPermission('operations', 'view', request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await queryCloseReviews({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id }, new URL(request.url).searchParams), { headers });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { const value: unknown = await request.clone().json(); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid body'); body = value as Record<string, unknown>; }
  catch { return NextResponse.json({ error: '请求内容无效。' }, { status: 400 }); }
  const action = String(body.action ?? '');
  const approvalActions = ['configure-policy', 'decide-review'];
  const auth = await requireApiPermission('operations', approvalActions.includes(action) ? 'approve' : 'create', request);
  if (!auth.ok) return auth.response;
  try {
    const result = await mutateCloseReview({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id }, body);
    return NextResponse.json(result, { status: action === 'create-book' || action === 'create-period' || action === 'create-subject' || action === 'create-voucher' || action === 'reverse-voucher' ? 201 : 200, headers });
  } catch (error) { return errorResponse(error); }
}
