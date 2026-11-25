import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { WmsError } from '@/lib/wms/contracts';
import { WmsInputError } from '@/lib/wms/rules';
import {
  querySalesDailyFacts, materializeSalesDailyFacts,
  queryOrderFinanceEvents, materializeOrderFinanceEvents,
  queryAccountMappings, mutateAccountMapping,
  materializeMonthlyReconcile, queryMonthlyReconcile,
  queryFeeCategoryDict, mutateFeeCategoryDict,
} from '@/lib/gap-audit/fact-wiring-service';
import {
  queryBalanceProjections, rebuildBalanceProjection,
  recomputeSkuProfitWithKernel,
  queryProfitConfig, mutateProfitConfig, resolveEffectiveProfitParams,
  queryLiveProfit, applyLiveProfitEvents,
  queryConsolidation, computeConsolidation,
  queryFinanceAnomalies, detectAnomalies,
  checkVoucherFxEntries,
} from '@/lib/gap-audit/compute-wiring-service';
import { queryAuditObservability } from '@/lib/gap-audit/observability-wiring-service';
import {
  materializeAdsAttributionCoverage, materializeInventoryPlanning,
  auditMetricBases, runMaterializations, materializationSwitches,
} from '@/lib/gap-audit/materialize-wiring-service';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };

function errorResponse(scope: string, error: unknown) {
  if (error instanceof WmsError || error instanceof WmsInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return NextResponse.json({ error: error.code === 'P2002' ? '记录已存在（唯一键冲突），请刷新后重试。' : '数据冲突，请刷新后重试。' }, { status: 409 });
  }
  console.error(`[operations.gap-audit.${scope}]`, { name: error instanceof Error ? error.name : 'UnknownError' });
  return NextResponse.json({ error: '差距审计接线服务暂不可用。' }, { status: 500 });
}

function scopeOf(request: Request) {
  return { workspaceId: workspaceScopeFromRequest(request).workspaceId };
}

const READ_SECTIONS = new Set([
  'sales-daily-fact', 'order-finance-event', 'account-mapping', 'monthly-reconcile', 'fee-category-dict',
  'balance-projection', 'profit-config', 'live-profit', 'consolidation', 'finance-anomaly', 'observability',
  'metric-audit',
]);

export async function GET(request: Request) {
  const auth = await requireApiPermission('operations', 'view', request);
  if (!auth.ok) return auth.response;
  const { workspaceId } = scopeOf(request);
  const scope = { organizationId: auth.user.organizationId, workspaceId, actorUserId: auth.user.id };
  const p = new URL(request.url).searchParams;
  const section = p.get('section') ?? 'observability';
  try {
    switch (section) {
      case 'sales-daily-fact': return NextResponse.json(await querySalesDailyFacts(scope, p), { headers });
      case 'order-finance-event': return NextResponse.json(await queryOrderFinanceEvents(scope, p), { headers });
      case 'account-mapping': return NextResponse.json(await queryAccountMappings(scope, p), { headers });
      case 'monthly-reconcile': return NextResponse.json(await queryMonthlyReconcile(scope, p), { headers });
      case 'fee-category-dict': return NextResponse.json(await queryFeeCategoryDict(scope, p), { headers });
      case 'balance-projection': return NextResponse.json(await queryBalanceProjections(scope, p), { headers });
      case 'profit-config': return NextResponse.json(await queryProfitConfig(scope, p), { headers });
      case 'live-profit': return NextResponse.json(await queryLiveProfit(scope, p), { headers });
      case 'consolidation': return NextResponse.json(await queryConsolidation(scope, p), { headers });
      case 'finance-anomaly': return NextResponse.json(await queryFinanceAnomalies(scope, p), { headers });
      case 'observability': return NextResponse.json(await queryAuditObservability(scope), { headers });
      case 'metric-audit': return NextResponse.json({ audit: auditMetricBases(), switches: materializationSwitches() }, { headers });
      default: return NextResponse.json({ error: `未知 section：${section}`, supported: [...READ_SECTIONS] }, { status: 400 });
    }
  } catch (error) { return errorResponse(section, error); }
}

const APPROVE_ACTIONS = new Set([
  'review-account-mapping', 'rebuild-balance-projection', 'review-profit-config', 'push-consolidation',
]);

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    const value: unknown = await request.clone().json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid body');
    body = value as Record<string, unknown>;
  } catch { return NextResponse.json({ error: '请求内容无效。' }, { status: 400 }); }

  const action = String(body.action ?? '');
  const auth = await requireApiPermission('operations', APPROVE_ACTIONS.has(action) ? 'approve' : 'create', request);
  if (!auth.ok) return auth.response;
  const { workspaceId } = scopeOf(request);
  const scope = { organizationId: auth.user.organizationId, workspaceId, actorUserId: auth.user.id };
  try {
    switch (action) {
      // P4-A 事实层
      case 'materialize-sales-daily-fact': return NextResponse.json(await materializeSalesDailyFacts(scope, body as never), { headers });
      case 'materialize-order-finance-events': return NextResponse.json(await materializeOrderFinanceEvents(scope, body as never), { headers });
      case 'create-account-mapping':
      case 'review-account-mapping':
      case 'resolve-account-mapping':
        return NextResponse.json(await mutateAccountMapping(scope, body), { headers });
      case 'materialize-monthly-reconcile': return NextResponse.json(await materializeMonthlyReconcile(scope, body as never), { headers });
      case 'upsert-fee-category': return NextResponse.json(await mutateFeeCategoryDict(scope, body), { headers });
      // P4-B 计算服务
      case 'rebuild-balance-projection': return NextResponse.json(await rebuildBalanceProjection(scope, body as never), { headers });
      case 'create-profit-config':
      case 'review-profit-config':
        return NextResponse.json(await mutateProfitConfig(scope, body), { headers });
      case 'apply-live-profit-events': return NextResponse.json(await applyLiveProfitEvents(scope, body as never), { headers });
      case 'compute-consolidation':
      case 'push-consolidation':
        return NextResponse.json(await computeConsolidation(scope, body), { headers });
      case 'recompute-sku-profit-kernel':
        return NextResponse.json(recomputeSkuProfitWithKernel(scope, (body.rows ?? []) as never), { headers });
      case 'detect-finance-anomalies': return NextResponse.json(await detectAnomalies(scope, body as never), { headers });
      case 'check-voucher-fx': return NextResponse.json(await checkVoucherFxEntries(scope, body as never), { headers });
      case 'resolve-profit-params': {
        const shopId = String(body.shopId ?? '').trim(), country = String(body.country ?? '').trim();
        if (!shopId || !country) return NextResponse.json({ error: '店铺 ID 与国家码必填。' }, { status: 400 });
        return NextResponse.json(await resolveEffectiveProfitParams(scope, shopId, country), { headers });
      }
      // P4-D 调度物化
      case 'materialize-ads-attribution': return NextResponse.json(await materializeAdsAttributionCoverage(scope, body as never), { headers });
      case 'materialize-inventory-planning': return NextResponse.json(await materializeInventoryPlanning(scope, body as never), { headers });
      case 'run-materializations': return NextResponse.json(await runMaterializations(scope, (body.tasks ?? []) as never), { headers });
      default: return NextResponse.json({ error: `未知 action：${action}` }, { status: 400 });
    }
  } catch (error) { return errorResponse(action, error); }
}
