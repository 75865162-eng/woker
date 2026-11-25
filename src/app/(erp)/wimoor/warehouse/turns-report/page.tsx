'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/form-controls';

/**
 * WIMOOR「仓库 → 报表 → 周转报告」功能迁移（只读对照入口）。
 * 源组件：erp/warehouse/inventory/report/turns/index.vue
 * 本项目已有等价页：/wms 库存周转与 /amazon/inventory；本页只做轻量对照。
 * 还原交互：日期选择 / SKU 搜索 / 图片、期初、期末、采购、入库、出库、发货、调库、组装、盘点、
 *          库存差异、周转个数、周转天数只读列 / 导出语义。
 */
type Row = Record<string, unknown> & { id: string };
const text = (key: string) => function Cell(row: Row) { return <span>{row[key] == null || row[key] === '' ? '—' : String(row[key])}</span>; };
function headersForScope(): Headers {
  const h = new Headers();
  try {
    const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string };
    h.set('x-workspace-id', v.workspaceId || 'default');
  } catch { h.set('x-workspace-id', 'default'); }
  return h;
}
export default function WimoorWarehouseTurnsReportPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [date, setDate] = useState('');
  const [sku, setSku] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'warehouse.turns-report', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);
  useEffect(() => { void load(); }, [load]);
  const visibleRows = useMemo(() => rows.filter(r => (!sku || String(r.sku ?? '').toLowerCase().includes(sku.toLowerCase())) && (!date || String(rowDate(r)) === date)), [rows, sku, date]);
  const columns: DataTableColumn<Row>[] = [
    { key: 'image', header: '图片', width: 80, render: text('image') },
    { key: 'sku', header: '产品信息', width: 180, render: text('sku') },
    { key: 'warehousename', header: '仓库', width: 150, render: text('warehousename') },
    { key: 'startqty', header: '期初', width: 100, numeric: true, render: text('startqty') },
    { key: 'endqty', header: '期末', width: 100, numeric: true, render: text('endqty') },
    { key: 'purchase', header: '采购', width: 100, numeric: true, render: text('purchase') },
    { key: 'otherin', header: '入库', width: 100, numeric: true, render: text('otherin') },
    { key: 'otherout', header: '出库', width: 100, numeric: true, render: text('otherout') },
    { key: 'shipment', header: '发货', width: 100, numeric: true, render: text('shipment') },
    { key: 'dispatch', header: '调库', width: 100, numeric: true, render: text('dispatch') },
    { key: 'assembly', header: '组装', width: 100, numeric: true, render: text('assembly') },
    { key: 'stock', header: '盘点', width: 100, numeric: true, render: text('stock') },
    { key: 'diff', header: '库存差异', width: 110, numeric: true, render: text('diff') },
    { key: 'period', header: '周转个数', width: 110, numeric: true, render: text('period') },
    { key: 'turndays', header: '周转天数', width: 110, numeric: true, render: text('turndays') },
  ];
  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">周转报告</h1><p className="text-xs text-muted">WIMOOR 周转报告迁移（只读对照）：日期/SKU 筛选与期初期末、出入库、周转指标；完整报表见 /wms 库存周转。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">选择日期
            <Input aria-label="选择日期" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <Input aria-label="请输入SKU" value={sku} placeholder="请输入SKU" onChange={(e) => setSku(e.target.value)} />
        </div>
        <DataTable<Row> columns={columns} rows={visibleRows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无周转报告记录。本页只读，不预置伪造周转指标。"
          ariaLabel="周转报告" />
      </section>
    </div>
  );
}
function rowDate(row: Row): unknown { return row.date ?? row.businessDate ?? ''; }
