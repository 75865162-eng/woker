'use client';
import { useCallback, useEffect, useState } from 'react';
import { StandardDataTable } from '@/components/ui/table-variants';
import { type DataTableColumn } from '@/components/ui/data-table';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';
import { ListPageTemplate } from '@/components/templates/page-templates';

type FeePools = Record<string, string>;
type PivotRow = {
  sku: string; currency: string; lineCount: number; basis: string;
  fees: FeePools; feeTotal: string; settlementMargin: string; marginRate: string | null;
};
type Result = { rows: PivotRow[]; basis: string; asOf: string; truncated: boolean };

const cls = 'h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
const FEE_LABELS: Array<[string, string]> = [
  ['storageFee', '仓储费'], ['longStorageFee', '长期仓储费'], ['advSpendFee', '广告费'],
  ['couponRedemptionFee', '优惠券费'], ['reserveFee', '预留金'], ['reimbursementFee', '赔偿'],
  ['disposalFee', '弃置费'], ['shopOtherFee', '店铺其他费'],
];

const columns: DataTableColumn<PivotRow>[] = [
  { key: 'sku', header: 'SKU', width: 160, render: row => row.sku },
  { key: 'currency', header: '币种', width: 64, render: row => row.currency },
  { key: 'lineCount', header: '明细行', width: 70, render: row => row.lineCount },
  { key: 'basis', header: '结算本金', width: 110, render: row => row.basis },
  ...FEE_LABELS.map(([key, label]) => ({ key: `fee_${key}`, header: label, width: 92, render: (row: PivotRow) => row.fees[key] ?? '—' })),
  { key: 'feeTotal', header: '费用合计', width: 100, render: row => row.feeTotal },
  { key: 'settlementMargin', header: '结算口径毛利', width: 120, render: row => <span className={row.settlementMargin.startsWith('-') ? 'text-danger-ink' : 'text-success-ink'}>{row.settlementMargin}</span> },
  { key: 'marginRate', header: '毛利率', width: 80, render: row => row.marginRate === null ? '—' : `${(Number(row.marginRate) * 100).toFixed(2)}%` },
];

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; h.set('x-workspace-id', v.workspaceId || 'default'); }
  catch { h.set('x-workspace-id', 'default'); }
  return h;
}

export function SettlementSkuPivotWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [sku, setSku] = useState('');
  const [currency, setCurrency] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = new URLSearchParams();
    if (sku.trim()) params.set('sku', sku.trim());
    if (currency.trim()) params.set('currency', currency.trim());
    try {
      const response = await fetch(`/api/operations/settlement-sku-pivot?${params}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '结算 SKU 透视读取失败。');
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '结算 SKU 透视读取失败。'); }
    finally { setLoading(false); }
  }, [sku, currency]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setSku(''); setCurrency(''); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  return <div data-testid="settlement-sku-pivot-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">按已发布结算分摊行，以 SKU + 币种分组，将 8 类费用池透视成列。<strong>原币不折算</strong>（汇率来源待业务确认）。结算口径毛利 = 结算本金 − 8 类费用，未含采购成本 / 广告全量 / 税费 / 本地费用，<strong>非最终利润</strong>，请结合利润报表解读。缺失不补零，金额字符串保真。</p>
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        {data && <p className="text-xs text-muted" data-testid="pivot-asof">数据快照：{data.asOf} · 口径：{data.basis}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="grid gap-1 text-xs">SKU 筛选<input aria-label="SKU 筛选" className={cls} placeholder="包含匹配" value={sku} onChange={e => setSku(e.target.value)} /></label>
        <label className="grid gap-1 text-xs">币种<input aria-label="币种筛选" className={cls} placeholder="如 USD" value={currency} onChange={e => setCurrency(e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? '读取中…' : '应用筛选'}</button>
      </section>}
      table={<StandardDataTable
        ariaLabel="结算 SKU 费用透视表"
        rows={data?.rows ?? []}
        getRowKey={row => `${row.currency}:${row.sku}`}
        columns={columns}
        empty={loading ? '读取中…' : '当前工作区暂无已发布的结算 SKU 分摊数据；请先在「结算 SKU 分摊」生成并交接批次。'}
      />}
    />
    {data?.truncated && <p className="text-xs text-warning-ink">透视行超过上限，仅显示部分数据，请按 SKU / 币种缩小范围。</p>}
  </div>;
}
