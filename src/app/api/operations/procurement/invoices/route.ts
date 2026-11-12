import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { prisma } from '@/lib/db/prisma';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { WmsError } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';
import { createPurchaseInvoice, decidePurchaseInvoiceApproval, invoiceReconciliation, rematchPurchaseInvoice, submitPurchaseInvoiceApproval, voidPurchaseInvoice } from '@/lib/procurement/invoice-service';

export const runtime = 'nodejs';

const errorResponse = (error: unknown) => {
  if (error instanceof WmsError || error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status ?? 400 });
  if (error instanceof Prisma.PrismaClientKnownRequestError) return NextResponse.json({ error: error.code === 'P2002' ? '该供应商发票号已登记，请核对后重试。' : '采购发票记录冲突，请刷新后重试。' }, { status: 409 });
  console.error('[operations.procurement.invoices]', { name: error instanceof Error ? error.name : 'UnknownError' });
  return NextResponse.json({ error: '采购发票服务暂不可用。' }, { status: 500 });
};

async function scopeFor(request: Request, action: 'view' | 'create' | 'edit' | 'approve') {
  const auth = await requireApiPermission('operations', action, request);
  if (!auth.ok) return { response: auth.response } as const;
  return { user: auth.user, scope: { organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId } } as const;
}

type InvoiceRow = Prisma.PurchaseInvoiceGetPayload<{ include: { lines: true; supplier: { select: { id: true; name: true } }; purchaseOrder: { select: { id: true; number: true } } } }>;

const serialize = (invoice: InvoiceRow) => ({
  ...invoice,
  invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
  dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : null,
  amountTolerance: invoice.amountTolerance.toString(),
  subtotal: invoice.subtotal.toString(),
  taxAmount: invoice.taxAmount.toString(),
  totalAmount: invoice.totalAmount.toString(),
  lines: invoice.lines.map(line => ({
    ...line,
    poUnitPrice: line.poUnitPrice.toString(),
    unitPrice: line.unitPrice.toString(),
    amount: line.amount.toString(),
    taxAmount: line.taxAmount.toString(),
    varianceAmount: line.varianceAmount.toString(),
  })),
});

export async function GET(request: Request) {
  const auth = await scopeFor(request, 'view');
  if ('response' in auth) return auth.response;
  const { organizationId, workspaceId } = auth.scope;
  try {
    const params = new URL(request.url).searchParams;
    const view = params.get('view');

    if (view === 'reconciliation') {
      const orderId = params.get('orderId')?.trim() ?? '';
      if (!orderId) return NextResponse.json({ error: '请指定采购订单。' }, { status: 400 });
      return NextResponse.json(await invoiceReconciliation({ organizationId, workspaceId, actorUserId: auth.user.id }, orderId), { headers: { 'Cache-Control': 'no-store' } });
    }

    const id = params.get('id');
    if (id) {
      const invoice = await prisma.purchaseInvoice.findFirst({
        where: { organizationId, workspaceId, id },
        include: {
          lines: { include: { product: { select: { sku: true, chineseName: true, englishName: true } } } },
          supplier: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, number: true } },
          approvals: { orderBy: { createdAt: 'desc' }, take: 5 },
        },
      });
      if (!invoice) return NextResponse.json({ error: '采购发票不存在。' }, { status: 404 });
      return NextResponse.json({ invoice: serialize(invoice as InvoiceRow) }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const status = params.get('status') ?? '';
    const search = params.get('q')?.trim() ?? '';
    const [invoices, orders] = await Promise.all([
      prisma.purchaseInvoice.findMany({
        where: {
          organizationId,
          workspaceId,
          ...(status ? { status } : {}),
          ...(search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }, { supplierInvoiceNo: { contains: search, mode: 'insensitive' } }] } : {}),
        },
        include: {
          lines: true,
          supplier: { select: { id: true, name: true } },
          purchaseOrder: { select: { id: true, number: true } },
          approvals: { where: { status: 'PENDING' }, orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, revision: true, requestedBy: true } },
        },
        orderBy: [{ invoiceDate: 'desc' }, { createdAt: 'desc' }],
        take: 100,
      }),
      prisma.purchaseOrder.findMany({
        where: { organizationId, workspaceId, status: { in: ['ORDERED', 'RECEIVING'] } },
        select: { id: true, number: true, status: true, currency: true, supplier: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);
    return NextResponse.json({ invoices: (invoices as InvoiceRow[]).map(serialize), orders }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const auth = await scopeFor(request, 'create');
  if ('response' in auth) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action !== 'invoice') return NextResponse.json({ error: '未知采购发票操作。' }, { status: 400 });
    const invoice = await createPurchaseInvoice({ ...auth.scope, actorUserId: auth.user.id }, body);
    return NextResponse.json({ invoice: serialize(invoice as InvoiceRow) }, { status: 201 });
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
      const result = await decidePurchaseInvoiceApproval(scope, body);
      return NextResponse.json({ approval: result.approval, invoice: serialize(result.invoice as InvoiceRow) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'rematch') {
      return NextResponse.json({ invoice: serialize(await rematchPurchaseInvoice(scope, body) as InvoiceRow) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'submit-approval') {
      const result = await submitPurchaseInvoiceApproval(scope, body);
      return NextResponse.json({ invoice: serialize(result.invoice as InvoiceRow), approval: result.approval }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'void-invoice') {
      return NextResponse.json({ invoice: serialize(await voidPurchaseInvoice(scope, body) as InvoiceRow) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: '未知采购发票操作。' }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
