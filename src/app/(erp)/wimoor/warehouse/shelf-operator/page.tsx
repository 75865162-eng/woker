'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';
import { useReadOnlyListFeatureBridge } from '@/components/wimoor-migration/use-readonly-list-feature-bridge';

/**
 * WIMOOR「仓库 → 报表 → 上下架明细」功能迁移（只读对照入口）。
 * 源组件：erp/warehouse/shelf/operator/index.vue
 * 本项目已有等价页：/wms 上下架流水；本页只做轻量对照。
 * 还原交互：全部仓库下拉 / SKU 搜索 / 产品信息、仓库-库位、操作数量、结余数量、单据类型、
 *          操作类型、操作时间、操作人只读列 / 导入导出语义。
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
export default function WimoorWarehouseShelfOperatorPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const { bridge, applyFeatureFilters } = useReadOnlyListFeatureBridge(rows);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [warehouse, setWarehouse] = useState('');
  const [sku, setSku] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'warehouse.shelf-operator', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);
  useEffect(() => { void load(); }, [load]);
  const warehouseOptions = useMemo(() => Array.from(new Set(rows.map(r => String(r.warehousename ?? r.warehouse ?? '')).filter(Boolean))).map(v => ({ value: v, label: v })), [rows]);
  const visibleRows = useMemo(() => rows.filter(r => {
    const wh = String(r.warehousename ?? r.warehouse ?? '');
    return (!warehouse || wh === warehouse) && (!sku || JSON.stringify(r).toLowerCase().includes(sku.toLowerCase()));
  }), [rows, warehouse, sku]);
  const columns: DataTableColumn<Row>[] = [
    { key: 'sku', header: '产品信息', width: 200, render: text('sku') },
    { key: 'shelfname', header: '仓库-库位', width: 180, render: text('shelfname') },
    { key: 'quantity', header: '操作数量', width: 120, numeric: true, render: text('quantity') },
    { key: 'balance_qty', header: '结余数量', width: 120, numeric: true, render: text('balance_qty') },
    { key: 'formname', header: '单据类型', width: 140, render: text('formname') },
    { key: 'optname', header: '操作类型', width: 120, render: text('optname') },
    { key: 'opttime', header: '操作时间', width: 170, render: text('opttime') },
    { key: 'operator', header: '操作人', width: 110, render: text('operator') },
  ];
  return (
    <div className="p-4">
      <WimoorFeaturePanel route="/wimoor/warehouse/shelf-operator" bridge={bridge} />
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">上下架明细</h1><p className="text-xs text-muted">WIMOOR 上下架明细迁移（只读对照）：全部仓库/SKU 筛选与上架下架流水；完整流水见 /wms 上下架工作台。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">仓库
            <Select aria-label="全部仓库" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} options={warehouseOptions} placeholder="全部仓库" />
          </label>
          <Input aria-label="请输入SKU" value={sku} placeholder="请输入SKU" onChange={(e) => setSku(e.target.value)} />
        </div>
        <DataTable<Row> columns={columns} rows={applyFeatureFilters(visibleRows)} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无上下架明细。本页只读，不预置伪造流水。"
          ariaLabel="上下架明细" />
      </section>
    </div>
  );
}
