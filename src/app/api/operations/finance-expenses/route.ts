import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { createFinanceExpense, mutateFinanceExpense, queryFinanceExpenses } from '@/lib/finance/expense-service';
import { WmsError } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
function failure(error: unknown) {
  if (error instanceof WmsError || error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ error: error.code === 'P2002' ? '费用单号已存在。' : '费用记录冲突，请刷新后重试。' }, { status: 409, headers });
  console.error('[operations.finance-expenses]', { name: error instanceof Error ? error.name : 'UnknownError' });
  return NextResponse.json({ error: '费用服务暂不可用。' }, { status: 500, headers });
}
export async function GET(request: Request) {
  const auth = await requireApiPermission('operations', 'view', request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await queryFinanceExpenses({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id }), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) return NextResponse.json({ error: '请求对象无效。' }, { status: 400, headers });
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: '请求内容无效。' }, { status: 400, headers }); }
  const action = String(body.action ?? '');
  const permission = ['approve', 'reject'].includes(action) ? 'approve' : 'create';
  const auth = await requireApiPermission('operations', permission, request);
  if (!auth.ok) return auth.response;
  const scope = { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id };
  try {
    const result = action === 'create' ? await createFinanceExpense(scope, body) : await mutateFinanceExpense(scope, body);
    return NextResponse.json(result, { status: action === 'create' ? 201 : 200, headers });
  } catch (error) { return failure(error); }
}
