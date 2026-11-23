'use client';
import { useCallback, useEffect, useState } from 'react';
import { StandardDataTable } from '@/components/ui/table-variants';
import { type DataTableColumn } from '@/components/ui/data-table';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';
import { ListPageTemplate } from '@/components/templates/page-templates';

type FeePools = Record<string, string>;
type SkuRow = {
  sku: string; currency: string; principal: string; platformFees: FeePools; platformFeeTotal: string;
  settlementMargin: string; marginRate: string | null; adSpend: string | null; adSpendNote: string | null;
  cost: null; tax: null; localExpense: null; pendingSources: string[];
};
type StoreRow = { settlementId: string; currency: string; skuCount: number; principal: string; platformFeeTotal: string; settlementMargin: string };
type Result = {
  skuRows: SkuRow[]; storeRows: StoreRow[]; basis: string; asOf: string; truncated: boolean;
  sources: { settlementPivot: string; adSpend: string; pending: string[] };
};

const cls = 'h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
const FEE_LABELS: Array<[string, string]> = [
  ['storageFee', '仓储费'], ['longStorageFee', '长期仓储费'], ['advSpendFee', '平台广告费'],
  ['couponRedemptionFee', '优惠券费'], ['reserveFee', '预留金'], ['reimbursementFee', '赔偿'],
  ['disposalFee', '弃置费'], ['shopOtherFee', '店铺其他费'],
];

const storeColumns: DataTableColumn<StoreRow>[] = [
  { key: 'settlementId', header: '结算批次（店铺代理）', width: 180, render: r => r.settlementId },
  { key: 'currency', header: '币种', width: 64, render: r => r.currency },
  { key: 'skuCount', header: 'SKU 数', width: 72, render: r => r.skuCount },
  { key: 'principal', header: '结算本金', width: 110, render: r => r.principal },
  { key: 'fee', header: '平台费用合计', width: 110, render: r => r.platformFeeTotal },
  { key: 'margin', header: '结算口径毛利', width: 120, render: r => <span className={r.settlementMargin.startsWith('-') ? 'text-danger-ink' : 'text-success-ink'}>{r.settlementMargin}</span> },
];

const skuColumns: DataTableColumn<SkuRow>[] = [
  { key: 'sku', header: 'SKU', width: 150, render: r => r.sku },
  { key: 'currency', header: '币种', width: 60, render: r => r.currency },
  { key: 'principal', header: '结算本金', width: 100, render: r => r.principal },
  ...FEE_LABELS.map(([key, label]) => ({ key: `fee_${key}`, header: label, width: 84, render: (r: SkuRow) => r.platformFees[key] ?? '—' })),
  { key: 'feeTotal', header: '平台费用', width: 90, render: r => r.platformFeeTotal },
  { key: 'margin', header: '结算口径毛利', width: 110, render: r => <span className={r.settlementMargin.startsWith('-') ? 'text-danger-ink' : 'text-success-ink'}>{r.settlementMargin}</span> },
  { key: 'adSpend', header: '广告花费（参考）', width: 120, render: r => r.adSpend === null ? '—' : <span title={r.adSpendNote ?? ''}>{r.adSpend}</span> },
  { key: 'cost', header: '采购成本', width: 90, render: () => <span className="text-muted">待接入</span> },
  { key: 'tax', header: '税费', width: 80, render: () => <span className="text-muted">待接入</span> },
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; h.set('x-workspace-id', v.workspaceId || 'default'); }
  catch { h.set('x-workspace-id', 'default'); }
  return h;
}

export function ProfitReportWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'STORE' | 'SKU'>('STORE');
  const [showBasis, setShowBasis] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/operations/profit-report', { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '利润报表读取失败。');
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '利润报表读取失败。'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  return <div data-testid="profit-report-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">保守口径：原币不折算、成本/广告/税费分列不混算。「结算口径毛利」= 结算本金 − 8 类平台费用，<strong>非最终净利润</strong>。采购成本 / 税费 / 本地费用口径待业务确认，本版未并入。</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? '收起' : '查看'}完整口径说明</button>
          {data && <span className="text-muted" data-testid="profit-asof">数据快照：{data.asOf}{data.truncated ? '（部分数据）' : ''}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
        <div className="flex gap-1">
          <button type="button" aria-pressed={tab === 'STORE'} className={`rounded border px-3 py-1 text-sm ${tab === 'STORE' ? 'border-border bg-surface' : 'border-border text-muted'}`} onClick={() => setTab('STORE')}>店铺汇总</button>
          <button type="button" aria-pressed={tab === 'SKU'} className={`rounded border px-3 py-1 text-sm ${tab === 'SKU' ? 'border-border bg-surface' : 'border-border text-muted'}`} onClick={() => setTab('SKU')}>SKU 明细</button>
        </div>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? '读取中…' : '刷新'}</button>
      </section>}
      table={tab === 'STORE'
        ? <StandardDataTable ariaLabel="利润报表店铺汇总" rows={data?.storeRows ?? []} getRowKey={r => `${r.settlementId}:${r.currency}`} columns={storeColumns} empty={loading ? '读取中…' : '暂无已发布结算数据，无法生成利润汇总。'} />
        : <StandardDataTable ariaLabel="利润报表 SKU 明细" rows={data?.skuRows ?? []} getRowKey={r => `${r.currency}:${r.sku}`} columns={skuColumns} empty={loading ? '读取中…' : '暂无已发布结算 SKU 数据。'} />}
    />
    {data?.sources && <p className="mt-2 text-xs text-muted">数据来源：结算透视 = {data.sources.settlementPivot}；广告花费 = {data.sources.adSpend}；待接入 = {data.sources.pending.join('、')}。</p>}
  </div>;
}
