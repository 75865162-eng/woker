import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { queryProductCatalog, saveProductCatalog } from '@/lib/products/catalog-service';
import { ProductManagementError } from '@/lib/products/management-contract';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
function fail(error: unknown) {
  if (error instanceof ProductManagementError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  if (error instanceof SyntaxError) return NextResponse.json({ error: '请求无效。' }, { status: 400, headers });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: '字典编码已存在。' }, { status: 409, headers });
  return NextResponse.json({ error: '商品字典暂不可用。' }, { status: 503, headers });
}
export async function GET(request: Request) {
  const auth = await requireApiPermission('products', 'view', request); if (!auth.ok) return auth.response;
  try { return NextResponse.json(await queryProductCatalog({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actor: auth.user.id }, new URL(request.url).searchParams), { headers }); } catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  const auth = await requireApiPermission('products', 'edit', request); if (!auth.ok) return auth.response;
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProductManagementError('请求无效。');
    return NextResponse.json({ entry: await saveProductCatalog({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actor: auth.user.id }, body as Record<string, unknown>) }, { headers });
  } catch (error) { return fail(error); }
}
