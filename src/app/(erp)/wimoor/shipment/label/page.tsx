'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';

/**
 * WIMOOR「发货 → 物流海关 → 标签打印」功能迁移（只读对照入口）。
 * 源组件：amazon/listing/product_label/index.vue
 * 本项目已有等价页：/sellfox/shipments（FBA 货件工作台）、/amazon/inventory（库存）。
 * 还原交互：FNSKU 搜索(搜索ASIN或SKU) / 已添加·可添加切换 / 批量添加·导入添加·添加 / 全部清空·删除 /
 *          打印产品标签-PDF·Excel / 下载模板·上传文件；
 *          只读列：产品信息 / FBA库存 / 本地库存 / 打印数量 / 操作。本页不造数，仅读取用户显式创建的记录。
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

export default function WimoorShipmentLabelPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [added, setAdded] = useState('ADDED');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'shipment.label', pageSize: '100' });
      if (search) p.set('search', search);
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey, search]);

  useEffect(() => { void load(); }, [load]);

  const visibleRows = rows.filter((r) => !r.added || String(r.added) === added);
  const rawColumns: Array<Omit<DataTableColumn<Row>, 'render'> & { render?: DataTableColumn<Row>['render'] }> = [
    { key: 'psku', header: '产品信息', width: 220, render: (row) => (
      <span className="flex flex-col"><span>{String(row.pname ?? '—')}</span><span className="text-muted">{String(row.psku ?? '')} / FNSKU {String(row.sku ?? '')}</span></span>
    ) },
    { key: 'quantity', header: 'FBA库存', width: 110, numeric: true },
    { key: 'fulfillable', header: '本地库存', width: 110, numeric: true },
    { key: 'printQty', header: '打印数量', width: 110, numeric: true },
    { key: 'operation', header: '操作', width: 150, render: () => <span className="text-muted">打印产品标签-PDF / Excel</span> },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">标签打印</h1><p className="text-xs text-muted">WIMOOR 标签打印功能迁移（只读对照）：FNSKU 搜索与产品标签打印交互；完整操作见 /sellfox/shipments。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <div className="min-w-[220px] flex-1">
            <Input aria-label="FNSKU搜索" value={search} onChange={(e) => { setSearch(e.target.value); setReloadKey(k => k + 1); }} placeholder="搜索ASIN或SKU" />
          </div>
          <label className="flex items-center gap-2 text-sm">范围
            <Select aria-label="添加范围" value={added} onChange={(e) => setAdded(e.target.value)}
              options={[{ value: 'ADDED', label: '已添加' }, { value: 'AVAILABLE', label: '可添加' }]} />
          </label>
          <span className="text-sm text-muted">批量添加 · 导入添加 · 全部清空 · 下载模板 · 上传文件</span>
        </div>
        <DataTable<Row> columns={columns} rows={visibleRows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无产品标签记录。本页只读，系统不预置伪造数据。"
          ariaLabel="标签打印" />
      </section>
    </div>
  );
}
