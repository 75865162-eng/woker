'use client';
import { useCallback, useEffect, useState } from 'react';
import { StandardDataTable } from '@/components/ui/table-variants';
import { type DataTableColumn } from '@/components/ui/data-table';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';
import { ListPageTemplate } from '@/components/templates/page-templates';

type Row = {
  sku: string; settlementCurrency: string; lineCount: number; distinctOrders: number;
  settlementNet: string; typeBreakdown: Record<string, string>;
  costCurrency: string | null; purchaseCost: string | null; freightCost: string | null; otherCost: string | null;
  costTotalOriginal: string | null; fxRate: string | null; costTotalConverted: string | null;
  netProfit: string | null; netMargin: string | null;
  status: 'OK' | 'NO_COST' | 'NO_FX_RATE' | 'SAME_CURRENCY'; note: string | null;
};
type Result = {
  rows: Row[]; basis: string; asOf: string; totalLines: number; costCount: number; fxCount: number; truncated: boolean;
};

const STATUS: Record<string, string> = {
  OK: '已折算', SAME_CURRENCY: '同币种', NO_COST: '缺成本', NO_FX_RATE: '缺汇率',
};

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; h.set('x-workspace-id', v.workspaceId || 'default'); }
  catch { h.set('x-workspace-id', 'default'); }
  return h;
}

const columns: DataTableColumn<Row>[] = [
  { key: 'sku', header: 'SKU', width: 150, render: r => r.sku },
  { key: 'currency', header: '结算币种', width: 80, render: r => r.settlementCurrency },
  { key: 'orders', header: '订单数', width: 72, render: r => r.distinctOrders },
  { key: 'net', header: '结算净额', width: 110, render: r => r.settlementNet },
  { key: 'costCcy', header: '成本币种', width: 80, render: r => r.costCurrency ?? '—' },
  { key: 'cost', header: '成本合计(原币)', width: 120, render: r => r.costTotalOriginal ?? '—' },
  { key: 'fx', header: '汇率', width: 80, render: r => r.fxRate ?? '—' },
  { key: 'converted', header: '成本(结算币)', width: 120, render: r => r.costTotalConverted ?? '—' },
  { key: 'profit', header: '最终净利润', width: 120, render: r => r.netProfit === null ? <span className="text-muted" title={r.note ?? ''}>—</span> : <span className={r.netProfit.startsWith('-') ? 'text-danger-ink' : 'text-success-ink'}>{r.netProfit}</span> },
  { key: 'margin', header: '净利率', width: 90, render: r => r.netMargin ?? '—' },
  { key: 'status', header: '状态', width: 90, render: r => <span title={r.note ?? ''} className={r.status === 'OK' || r.status === 'SAME_CURRENCY' ? 'text-success-ink' : 'text-muted'}>{STATUS[r.status] ?? r.status}</span> },
];

export function SkuProfitFinalWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showBasis, setShowBasis] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/operations/sku-profit-final', { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '最终利润读取失败。');
      setData(result as Result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '最终利润读取失败。'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setData(null); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  return <div data-testid="sku-profit-final-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">最终净利润 = 结算净额 − 折算成本。未录入成本或缺汇率的行净利润留空（<strong>不造数</strong>）；请先在「SKU 成本录入」和「汇率配置」页维护数据。</p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowBasis(v => !v)}>{showBasis ? '收起' : '查看'}完整口径说明</button>
          {data && <span className="text-muted" data-testid="profit-final-asof">结算行 {data.totalLines} · 成本记录 {data.costCount} · 汇率 {data.fxCount}{data.truncated ? '（部分数据）' : ''} · 快照 {data.asOf}</span>}
        </div>
        {showBasis && data && <pre className="whitespace-pre-wrap rounded border border-border bg-surface p-2 text-xs text-muted">{data.basis}</pre>}
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
        <a href="/amazon/sku-cost" className="h-9 rounded border border-border bg-background px-3 text-sm leading-9">SKU 成本录入</a>
        <a href="/amazon/fx-rate" className="h-9 rounded border border-border bg-background px-3 text-sm leading-9">汇率配置</a>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void load()} disabled={loading}>{loading ? '读取中…' : '刷新'}</button>
      </section>}
      table={<StandardDataTable ariaLabel="SKU 最终利润" rows={data?.rows ?? []} getRowKey={r => `${r.settlementCurrency}:${r.sku}`} columns={columns} empty={loading ? '读取中…' : '暂无已归属结算数据。'} />}
    />
  </div>;
}
