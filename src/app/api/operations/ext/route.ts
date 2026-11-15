import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { WmsError } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';
import { requireText } from '@/lib/wms/rules';
import {
  capturePerformance, closeSalesPlan, computeTaxPeriod, decideQueueItem, decideReview, deleteCalcScheme,
  deleteDictionaryItem, fileTaxPeriod, generateRepricingQueue, quoteOnly, queryExt, saveCalcScheme,
  saveChannelAccount, saveChannelOrder, saveCustomField, saveDictionary, saveDictionaryItem,
  saveExchangeOrder, saveOfferWatch, savePaymentRequest, saveQuotation, saveRepricingRule,
  saveReview, saveSalesPlan, saveTaxInvoice, selectQuotation, transitionChannelOrder,
  transitionExchangeOrder, transitionPaymentRequest,
} from '@/lib/ext/service';

export const runtime = 'nodejs';

const errorResponse = (error: unknown) => {
  if (error instanceof WmsError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof WmsInputError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return NextResponse.json({ error: '编号或编码已存在，请更换后重试。' }, { status: 409 });
    if (error.code === 'P2003') return NextResponse.json({ error: '关联数据不存在或已被引用，请检查后重试。' }, { status: 409 });
    return NextResponse.json({ error: '数据写入冲突，请刷新后重试。' }, { status: 409 });
  }
  console.error('[operations.ext]', { name: error instanceof Error ? error.name : 'UnknownError', message: error instanceof Error ? error.message : '' });
  return NextResponse.json({ error: '功能域服务暂不可用。' }, { status: 500 });
};

async function scopeFor(request: Request, action: 'view' | 'edit' | 'create' | 'approve' | 'export') {
  const auth = await requireApiPermission('operations', action, request);
  if (!auth.ok) return { response: auth.response } as const;
  return {
    scope: {
      organizationId: auth.user.organizationId,
      workspaceId: workspaceScopeFromRequest(request).workspaceId,
      actorUserId: auth.user.id,
    },
  } as const;
}

type Handler = (scope: { organizationId: string; workspaceId: string; actorUserId: string }, body: Record<string, unknown>) => Promise<unknown>;

const writeActions: Record<string, { action: 'view' | 'edit' | 'create' | 'approve' | 'export'; handler: Handler }> = {
  'save-calc-scheme': { action: 'edit', handler: saveCalcScheme },
  'delete-calc-scheme': { action: 'edit', handler: deleteCalcScheme },
  'save-review': { action: 'edit', handler: saveReview },
  'decide-review': { action: 'edit', handler: decideReview },
  'capture-performance': { action: 'edit', handler: capturePerformance },
  'save-repricing-rule': { action: 'edit', handler: saveRepricingRule },
  'save-offer': { action: 'edit', handler: saveOfferWatch },
  'generate-queue': { action: 'create', handler: generateRepricingQueue },
  'decide-queue': { action: 'approve', handler: decideQueueItem },
  'save-sales-plan': { action: 'edit', handler: saveSalesPlan },
  'close-sales-plan': { action: 'approve', handler: closeSalesPlan },
  'save-payment-request': { action: 'edit', handler: savePaymentRequest },
  'transition-payment-request': { action: 'edit', handler: transitionPaymentRequest },
  'save-exchange-order': { action: 'edit', handler: saveExchangeOrder },
  'transition-exchange-order': { action: 'edit', handler: transitionExchangeOrder },
  'save-quotation': { action: 'edit', handler: saveQuotation },
  'select-quotation': { action: 'approve', handler: selectQuotation },
  'save-tax-invoice': { action: 'edit', handler: saveTaxInvoice },
  'compute-tax-period': { action: 'export', handler: computeTaxPeriod },
  'file-tax-period': { action: 'approve', handler: fileTaxPeriod },
  'save-channel-account': { action: 'edit', handler: saveChannelAccount },
  'save-channel-order': { action: 'create', handler: saveChannelOrder },
  'transition-channel-order': { action: 'edit', handler: transitionChannelOrder },
  'save-dictionary': { action: 'edit', handler: saveDictionary },
  'save-dictionary-item': { action: 'edit', handler: saveDictionaryItem },
  'delete-dictionary-item': { action: 'edit', handler: deleteDictionaryItem },
  'save-custom-field': { action: 'edit', handler: saveCustomField },
};

export async function GET(request: Request) {
  const auth = await scopeFor(request, 'view');
  if ('response' in auth) return auth.response;
  try {
    const url = new URL(request.url);
    const kind = url.searchParams.get('kind') ?? 'options';
    return NextResponse.json(await queryExt(auth.scope, kind, url.searchParams));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: '请求内容不是有效 JSON。' }, { status: 400 }); }
  try {
    const action = requireText(body.action, '操作类型', 60);
    // 纯测算不入库，只要查看权限即可。
    if (action === 'quote') {
      const auth = await scopeFor(request, 'view');
      if ('response' in auth) return auth.response;
      return NextResponse.json({ result: quoteOnly(requireText(body.kind, '测算类型', 20), body) });
    }
    const entry = writeActions[action];
    if (!entry) throw new WmsError('不支持的操作。', 400);
    const auth = await scopeFor(request, entry.action);
    if ('response' in auth) return auth.response;
    return NextResponse.json({ data: await entry.handler(auth.scope, body) });
  } catch (error) { return errorResponse(error); }
}
