'use client';
import { useCallback, useEffect, useState } from 'react';
import { StandardDataTable } from '@/components/ui/table-variants';
import { type DataTableColumn } from '@/components/ui/data-table';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';
import { ListPageTemplate } from '@/components/templates/page-templates';

type DayCell = { quantity: number | null; sales: Array<{ currency: string; amount: string }> };
type TodayRow = {
  sku: string; asin: string | null;
  today: DayCell; yesterday: DayCell; lastWeekSameDay: DayCell;
  fulfillable: number | null; reserved: number | null; inbound: number | null;
};
type TodayResult = { rows: TodayRow[]; today: string; basis: string; asOf: string; truncated: boolean };

type OrderAmount = { currency: string; amount: string };
type OrderPeriodAgg = {
  period: string; periodStart: string; periodEnd: string;
  orders: number; orderItems: number; units: string | null; sales: OrderAmount[];
};
type OrderPeriodResult = {
  bucket: 'day' | 'week' | 'month'; periods: OrderPeriodAgg[]; totals: OrderPeriodAgg;
  truncated: boolean; asOf: string; basis: string;
};

const cls = 'h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
const dash = (v: string | number | null | undefined) => v === null || v === undefined || v === '' ? '—' : String(v);
function salesText(cell: DayCell): string {
  if (!cell.sales.length) return '—';
  return cell.sales.map(s => `${s.amount} ${s.currency}`).join(' / ');
}

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; h.set('x-workspace-id', v.workspaceId || 'default'); }
  catch { h.set('x-workspace-id', 'default'); }
  return h;
}

function useSectionResult<T>(section: string, extra: Record<string, string>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const extraKey = JSON.stringify(extra);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const params = new URLSearchParams({ section, ...extra });
    try {
      const response = await fetch(`/api/operations/sync-center?${params}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '数据读取失败。');
      setData(result as T);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '数据读取失败。'); }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, extraKey, nonce]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => setNonce(n => n + 1);
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);
  return { data, error, loading, reload: () => setNonce(n => n + 1) };
}

const todayColumns: DataTableColumn<TodayRow>[] = [
  { key: 'sku', header: 'SKU', width: 150, render: row => row.sku },
  { key: 'asin', header: 'ASIN', width: 100, render: row => dash(row.asin) },
  { key: 'todayQty', header: '今日销量', width: 80, render: row => dash(row.today.quantity) },
  { key: 'todaySales', header: '今日销售额', width: 150, render: row => salesText(row.today) },
  { key: 'yestQty', header: '昨日销量', width: 80, render: row => dash(row.yesterday.quantity) },
  { key: 'yestSales', header: '昨日销售额', width: 150, render: row => salesText(row.yesterday) },
  { key: 'lwQty', header: '上周同日销量', width: 100, render: row => dash(row.lastWeekSameDay.quantity) },
  { key: 'lwSales', header: '上周同日销售额', width: 150, render: row => salesText(row.lastWeekSameDay) },
  { key: 'fulfillable', header: '可售', width: 70, render: row => dash(row.fulfillable) },
  { key: 'reserved', header: '预留', width: 70, render: row => dash(row.reserved) },
  { key: 'inbound', header: '在途', width: 70, render: row => dash(row.inbound) },
];

const orderColumns: DataTableColumn<OrderPeriodAgg>[] = [
  { key: 'period', header: '周期', width: 110, render: row => row.period },
  { key: 'range', header: '起止', width: 180, render: row => `${row.periodStart} ~ ${row.periodEnd}` },
  { key: 'orders', header: '订单数', width: 80, render: row => row.orders },
  { key: 'orderItems', header: '订单项数', width: 80, render: row => row.orderItems },
  { key: 'units', header: '销量', width: 80, render: row => dash(row.units) },
  { key: 'sales', header: '销售额（按币种）', width: 200, render: row => row.sales.length ? row.sales.map(s => `${s.amount} ${s.currency}`).join(' / ') : '—' },
];

export function TodayOrderWorkbench() {
  const [date, setDate] = useState('');
  const [bucket, setBucket] = useState<'day' | 'week' | 'month'>('week');
  const today = useSectionResult<TodayResult>('today-dashboard', date ? { date } : {});
  const periods = useSectionResult<OrderPeriodResult>('order-period', { bucket });

  return <div data-testid="today-order-workbench" className="space-y-6">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">今日订单看板：今日 / 昨日 / 上周同日三日并列，按 SKU 聚合销量与净销售额，并拼合最新库存快照。<strong>缺日显示「—」不补零</strong>，销售额按币种分列不跨币种相加。</p>
        {today.error && <p role="alert" className="text-sm text-danger-ink">{today.error}</p>}
        {today.data && <p className="text-xs text-muted">业务日：{today.data.today} · 快照：{today.data.asOf}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="grid gap-1 text-xs">业务日（YYYY-MM-DD，默认今日）<input aria-label="业务日" className={cls} placeholder="如 2026-11-23" value={date} onChange={e => setDate(e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={today.reload} disabled={today.loading}>{today.loading ? '读取中…' : '应用日期'}</button>
      </section>}
      table={<StandardDataTable
        ariaLabel="今日订单看板表"
        rows={today.data?.rows ?? []}
        getRowKey={row => row.sku}
        columns={todayColumns}
        empty={today.loading ? '读取中…' : '当前工作区暂无该业务日的已同步订单数据；请先同步订单或调整业务日。'}
      />}
    />
    {today.data?.truncated && <p className="text-xs text-warning-ink">订单/库存行超过上限，仅显示部分数据，请按业务日缩小范围。</p>}

    <section className="space-y-3 border-t border-border pt-6">
      <div className="space-y-2">
        <h2 className="text-lg font-semibold">周 / 月订单汇总</h2>
        <p className="text-body text-muted">按订单 <code>createdTime</code> 的 UTC 日期归入 day / week / month（ISO 周）。<strong>订单数按 distinct 订单号统计</strong>，不拿订单项数冒充；销售额按币种分列。</p>
        {periods.error && <p role="alert" className="text-sm text-danger-ink">{periods.error}</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs">聚合粒度
          <select aria-label="聚合粒度" className={cls} value={bucket} onChange={e => setBucket(e.target.value as 'day' | 'week' | 'month')}>
            <option value="day">日</option><option value="week">周</option><option value="month">月</option>
          </select>
        </label>
        {periods.data && <p className="text-xs text-muted">合计：订单 {periods.data.totals.orders} · 订单项 {periods.data.totals.orderItems} · 快照 {periods.data.asOf}</p>}
      </div>
      <StandardDataTable
        ariaLabel="周月订单汇总表"
        rows={periods.data?.periods ?? []}
        getRowKey={row => row.period}
        columns={orderColumns}
        empty={periods.loading ? '读取中…' : '当前工作区暂无已同步订单，请先在同步中心同步订单数据。'}
      />
      {periods.data?.truncated && <p className="text-xs text-warning-ink">订单行超过上限，汇总可能不完整，请缩小日期范围。</p>}
    </section>
  </div>;
}
