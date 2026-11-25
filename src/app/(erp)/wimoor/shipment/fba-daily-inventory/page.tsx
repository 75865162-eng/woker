'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/form-controls';

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

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'shipment.fbaDailyInventory', pageSize: '100' });
      if (search) p.set('search', search);
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey, search]);

  useEffect(() => { void load(); }, [load]);

  const rawColumns: Array<Omit<DataTableColumn<Row>, 'render'> & { render?: DataTableColumn<Row>['render'] }> = [
    { key: 'sku', header: '产品信息', width: 220, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'warehouse', header: '仓库', width: 150 },
    { key: 'byday', header: '按日库存', width: 180, render: (row) => {
      const days = row.byday ?? row.daily;
      if (days == null) return <span className="text-muted">—</span>;
      return <span>{typeof days === 'object' ? JSON.stringify(days) : String(days)}</span>;
    } },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">FBA每日库存</h1><p className="text-xs text-muted">WIMOOR FBA每日库存功能迁移（只读）：SKU 搜索与按日库存明细；完整库存工作台见 /amazon/inventory。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <div className="min-w-[220px] flex-1">
            <Input aria-label="SKU搜索" value={search} onChange={(e) => { setSearch(e.target.value); setReloadKey(k => k + 1); }} placeholder="请输入SKU" />
          </div>
          <span className="text-sm text-muted">导出（原页面按钮，本页只读不触发）</span>
        </div>
        <DataTable<Row> columns={columns} rows={rows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无每日库存记录。本页只读，系统不预置伪造库存。"
          ariaLabel="FBA每日库存" />
      </section>
    </div>
  );
}
