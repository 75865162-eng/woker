import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { WmsError } from '@/lib/wms/contracts';
import { captureUnsalable, queryOps, saveOpsMaster } from '@/lib/operations/ops-service';
import { requireText } from '@/lib/wms/rules';

export const runtime = 'nodejs';

const errorResponse = (error: unknown) => {
  if (error instanceof WmsError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ error: error.code === 'P2002' ? '编码已存在，请更换后重试。' : '运营资料记录冲突，请刷新后重试。' }, { status: 409 });
  console.error('[operations.ops-extensions]', { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : '' });
  return NextResponse.json({ error: '运营资料服务暂不可用。' }, { status: 500 });
};

async function scopeFor(request: Request, action: 'view' | 'edit') {
  const auth = await requireApiPermission('operations', action, request);
  if (!auth.ok) return { response: auth.response } as const;
  return { scope: {
    organizationId: auth.user.organizationId,
    workspaceId: workspaceScopeFromRequest(request).workspaceId,
    actorUserId: auth.user.id,
  } } as const;
}

export async function GET(request: Request) {
  const auth = await scopeFor(request, 'view');
  if ('response' in auth) return auth.response;
  const kind = new URL(request.url).searchParams.get('kind') ?? 'options';
  try { return NextResponse.json(await queryOps(auth.scope, kind)); }
  catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await scopeFor(request, 'edit');
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = requireText(body.action, '操作类型', 40);
    if (action === 'capture-unsalable') return NextResponse.json(await captureUnsalable(auth.scope, body));
    if (action === 'create-carrier' || action === 'update-carrier') return NextResponse.json(await saveOpsMaster(auth.scope, 'carrier', body));
    if (action === 'create-warehouse' || action === 'update-warehouse') return NextResponse.json(await saveOpsMaster(auth.scope, 'warehouse', body));
    throw new WmsError('不支持的运营资料操作。', 400);
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: '请求内容不是有效 JSON。' }, { status: 400 });
    return errorResponse(error);
  }
}
