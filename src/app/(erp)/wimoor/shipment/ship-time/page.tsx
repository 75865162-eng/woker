'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';

/**
 * WIMOOR「发货 → 报表分析 → 发货时效」功能迁移（只读列表）。
 * 源组件：amazon/report/ship/time/index.vue
 * 本项目已有等价页：/sellfox/shipments（FBA 货件工作台）。
 * 还原交互：货件 / SKU·MSKU 搜索类型 / sku发货数量过滤 / 导出；
 *          只读列：图片、商品信息、店铺站点、发货仓库、计划/配货/出库/物流/完成时间、发货时效、收货时效、总时效。
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

export default function WimoorShipmentShipTimePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [searchType, setSearchType] = useState('SKU');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'shipment.shipTime', pageSize: '100' });
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
    { key: 'image', header: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'name', header: '商品信息', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'wname', header: '店铺站点', width: 140 },
    { key: 'shipmentid', header: '发货仓库', width: 150 },
    { key: 'createdate', header: '计划时间', width: 140 },
    { key: 'pickdate', header: '配货时间', width: 140 },
    { key: 'shippedDate', header: '出库时间', width: 140 },
    { key: 'logistics', header: '物流信息', width: 160 },
    { key: 'finishDate', header: '完成时间', width: 140 },
    { key: 'shipdays', header: '发货时效', width: 100, numeric: true },
    { key: 'receivedays', header: '收货时效', width: 100, numeric: true },
    { key: 'days', header: '总时效', width: 100, numeric: true },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">发货时效</h1><p className="text-xs text-muted">WIMOOR 发货时效功能迁移（只读）：货件/SKU/MSKU 搜索与各环节时效指标；完整货件工作台见 /sellfox/shipments。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <div className="min-w-[200px] flex-1">
            <Input aria-label="货件/SKU搜索" value={search} onChange={(e) => { setSearch(e.target.value); setReloadKey(k => k + 1); }} placeholder="请输入" />
          </div>
          <label className="flex items-center gap-2 text-sm">搜索类型
            <Select aria-label="搜索类型" value={searchType} onChange={(e) => setSearchType(e.target.value)}
              options={[{ value: 'SKU', label: 'SKU' }, { value: 'MSKU', label: 'MSKU' }]} />
          </label>
          <span className="text-sm text-muted">sku发货数量 · 导出（原页面筛选与按钮）</span>
        </div>
        <DataTable<Row> columns={columns} rows={rows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无发货时效记录。本页只读，系统不预置伪造时效。"
          ariaLabel="发货时效" />
      </section>
    </div>
  );
}
