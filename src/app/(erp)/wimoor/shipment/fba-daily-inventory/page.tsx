'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/form-controls';
import { mapAmazonInventoryRows, AMAZON_INVENTORY_PAGE_BASIS, type AmazonInventoryRow } from '@/lib/wimoor-migration/amazon-inventory-adapter';

/**
 * WIMOOR「发货 → 报表分析 → FBA每日库存」功能迁移（只读列表）。
 * 源组件：amazon/inventory/fba/daily.vue
 * 本项目已有等价页：/amazon/inventory、/sellfox/inventory。
 * 还原交互：请输入SKU 搜索 / 导出；只读列：产品信息 / 仓库 / 按日库存动态列(item.byday → item.field)。
 */
type Row = Record<string, unknown> & { id: string };

function headersForScope(): Headers {
  const h = new Headers();
  try {
    const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string };
    h.set('x-workspace-id', v.workspaceId || 'default');
  } catch { h.set('x-workspace-id', 'default'); }
  return h;
}

export default function WimoorShipmentFbaDailyInventoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');

  const [snapshotStatus, setSnapshotStatus] = useState<string>('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // 落地页直接读取亚马逊真实库存快照（已发布 run）。
      const p = new URLSearchParams({ page: '1', pageSize: '100' });
      if (search) p.set('sku', search);
      const response = await fetch(`/api/operations/inventory/snapshots?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setSnapshotStatus(result.snapshot?.status ?? '');
      setRows(mapAmazonInventoryRows((result.rows ?? []) as AmazonInventoryRow[]) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey, search]);

  useEffect(() => { void load(); }, [load]);

  const rawColumns: Array<Omit<DataTableColumn<Row>, 'render'> & { render?: DataTableColumn<Row>['render'] }> = [
    { key: 'sku', header: '产品信息', width: 220, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'warehouse', header: '站点', width: 150 },
    { key: 'afnFulfillableQuantity', header: '可售', width: 100, numeric: true },
    { key: 'afnReservedQuantity', header: '预留', width: 100, numeric: true },
    { key: 'afnInboundWorkingQuantity', header: '发货中', width: 100, numeric: true },
    { key: 'afnUnsellableQuantity', header: '不可用', width: 100, numeric: true },
    { key: 'capturedAt', header: '快照时间', width: 180, render: (row) => row.capturedAt == null ? <span className="text-muted">—</span> : <span>{String(row.capturedAt)}</span> },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">FBA每日库存</h1><p className="text-xs text-muted">WIMOOR FBA每日库存：SKU 搜索与库存明细，数据自动匹配亚马逊已发布库存快照{snapshotStatus ? `（快照：${snapshotStatus}）` : ''}。{AMAZON_INVENTORY_PAGE_BASIS}</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <div className="min-w-[220px] flex-1">
            <Input aria-label="SKU搜索" value={search} onChange={(e) => { setSearch(e.target.value); setReloadKey(k => k + 1); }} placeholder="请输入SKU" />
          </div>
          <span className="text-sm text-muted">导出（原页面按钮，本页只读不触发）</span>
        </div>
        <DataTable<Row> columns={columns} rows={rows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无已发布的亚马逊库存快照。系统不预置伪造库存；请先同步并发布库存数据。"
          ariaLabel="FBA每日库存" />
      </section>
    </div>
  );
}
