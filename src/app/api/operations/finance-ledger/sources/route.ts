import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { previewFinanceSource, importFinanceSource } from '@/lib/finance/source-service';
import { FinanceRuleError } from '@/lib/finance/rules';
import { WmsError } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
function failure(error: unknown) {
  if (error instanceof SyntaxError) return NextResponse.json({ error: '请求内容无效。' }, { status: 400, headers });
  if (error instanceof WmsError || error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof FinanceRuleError) return NextResponse.json({ error: error.message }, { status: 422, headers });
  if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ error: '核算来源或总账记录冲突，请刷新核对。' }, { status: 409, headers });
  console.error('[finance.source]', { name: error instanceof Error ? error.name : 'UnknownError' });
  return NextResponse.json({ error: '核算来源交接暂不可用。' }, { status: 500, headers });
}
export async function GET(request: Request) {
  const auth = await requireApiPermission('operations', 'view', request);
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json(await previewFinanceSource({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id }, new URL(request.url).searchParams), { headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const auth = await requireApiPermission('operations', 'create', request);
  if (!auth.ok) return auth.response;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: '请求对象无效。' }, { status: 400, headers });
    const result = await importFinanceSource({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: auth.user.id }, body as Record<string, unknown>);
    return NextResponse.json(result, { status: result.reused ? 200 : 201, headers });
  } catch (error) { return failure(error); }
}
