import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { prisma } from '@/lib/db/prisma';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { WmsError } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';
import { cancelPurchasePlan, convertPurchasePlanToOrder, createPurchasePlan, decidePurchasePlanApproval, editPurchasePlanDraft, submitPurchasePlanApproval, suggestPlanRows } from '@/lib/procurement/plan-service';

export const runtime = 'nodejs';

const errorResponse = (error: unknown) => {
  if (error instanceof WmsError || error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status ?? 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ error: error.code === 'P2002' ? '计划单号已存在，请更换后重试。' : '采购计划记录冲突，请刷新后重试。' }, { status: 409 });
  console.error('[operations.procurement.plans]', { name: error instanceof Error ? error.name : 'UnknownError' });
  return NextResponse.json({ error: '采购计划服务暂不可用。' }, { status: 500 });
};

async function scopeFor(request: Request, action: 'view' | 'create' | 'edit' | 'approve') {
  const auth = await requireApiPermission('operations', action, request);
  if (!auth.ok) return { response: auth.response } as const;
  return { user: auth.user, scope: { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId } } as const;
}

const lineInclude = { product: { select: { sku: true, chineseName: true, englishName: true } } } as const;
const serialize = (plan: { lines: Array<{ unitPrice: Prisma.Decimal } & Record<string, unknown>> } & Record<string, unknown>) => ({
  ...plan,
  periodStart: plan.periodStart instanceof Date ? plan.periodStart.toISOString().slice(0, 10) : plan.periodStart,
  periodEnd: plan.periodEnd instanceof Date ? plan.periodEnd.toISOString().slice(0, 10) : plan.periodEnd,
  lines: plan.lines.map(line => ({ ...line, unitPrice: line.unitPrice.toString() })),
});

export async function GET(request: Request) {
  const auth = await scopeFor(request, 'view');
  if ('response' in auth) return auth.response;
  const { organizationId, workspaceId } = auth.scope;
  try {
    const params = new URL(request.url).searchParams;
    if (params.get('view') === 'suggestions') {
      const int = (key: string, fallback: number) => {
        const raw = params.get(key);
        const parsed = raw === null || raw === '' ? fallback : Number(raw);
        return Number.isInteger(parsed) ? parsed : fallback;
      };
      const rows = await suggestPlanRows({ organizationId, workspaceId, actorUserId: auth.user.id }, {
        salesWindowDays: int('salesWindowDays', 90),
        coverageDays: int('coverageDays', 60),
        safetyDays: int('safetyDays', 15),
        limit: int('limit', 200),
      });
      return NextResponse.json({ rows }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const id = params.get('id');
    if (id) {
      const plan = await prisma.purchasePlan.findFirst({ where: { organizationId, workspaceId, id }, include: { supplier: { select: { id: true, name: true } }, lines: { include: lineInclude }, approvals: { orderBy: { createdAt: 'desc' }, take: 5 } } });
      if (!plan) return NextResponse.json({ error: '采购计划不存在。' }, { status: 404 });
      return NextResponse.json({ plan: serialize(plan) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const status = params.get('status') ?? '';
    const number = params.get('number')?.trim() ?? '';
    const plans = await prisma.purchasePlan.findMany({
      where: { organizationId, workspaceId, ...(status ? { status } : {}), ...(number ? { number: { contains: number, mode: 'insensitive' } } : {}) },
      include: { supplier: { select: { id: true, name: true } }, lines: { include: lineInclude }, approvals: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, revision: true, requestedBy: true } } },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    const suppliers = await prisma.supplier.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 500 });
    const products = await prisma.productSummaryRecord.findMany({ where: { organizationId, workspaceId }, orderBy: { sku: 'asc' }, take: 500, select: { productRecordId: true, sku: true, chineseName: true, englishName: true } });
    return NextResponse.json({ plans: plans.map(serialize), suppliers, products }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await scopeFor(request, 'create');
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== 'plan') return NextResponse.json({ error: '未知采购计划操作。' }, { status: 400 });
    const plan = await createPurchasePlan({ ...auth.scope, actorUserId: auth.user.id }, body);
    return NextResponse.json({ plan: serialize(plan) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.clone().json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: '请求内容无效。' }, { status: 400 }); }
  const permission = body.decision === 'APPROVE' || body.decision === 'REJECT' ? 'approve' : body.action === 'submit-approval' ? 'create' : 'edit';
  const auth = await scopeFor(request, permission);
  if ('response' in auth) return auth.response;
  const scope = { ...auth.scope, actorUserId: auth.user.id };
  try {
    if (body.decision === 'APPROVE' || body.decision === 'REJECT') {
      return NextResponse.json({ approval: await decidePurchasePlanApproval(scope, body) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'submit-approval') {
      const result = await submitPurchasePlanApproval(scope, body);
      return NextResponse.json({ plan: serialize(result.plan), approval: result.approval }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'edit-plan') {
      return NextResponse.json({ plan: serialize(await editPurchasePlanDraft(scope, body)) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'cancel-plan') {
      return NextResponse.json({ plan: serialize(await cancelPurchasePlan(scope, body)) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'convert-plan') {
      const result = await convertPurchasePlanToOrder(scope, body);
      return NextResponse.json({ plan: serialize(result.plan), orderId: result.order.id, orderNumber: result.order.number }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: '未知采购计划操作。' }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
