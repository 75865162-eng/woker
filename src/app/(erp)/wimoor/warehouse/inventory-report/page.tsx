'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';
import { useReadOnlyListFeatureBridge } from '@/components/wimoor-migration/use-readonly-list-feature-bridge';

/**
 * WIMOOR「仓库 → 报表 → 库存报表」功能迁移（只读对照入口）。
 * 源组件：erp/warehouse/inventory/report/base/index.vue
 * 本项目已有等价页：/amazon/inventory（FBA 库存）与 /wms 库存工作台；本页只做轻量对照。
 * 还原交互：全部仓库下拉 / SKU 搜索 / 产品信息、仓库、默认供应商、待入库、可用库存、待出库只读列。
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
export default function WimoorWarehouseInventoryReportPage() {
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
      const p = new URLSearchParams({ type: 'entry', kind: 'warehouse.inventory-report', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);
  useEffect(() => { void load(); }, [load]);
  const warehouseOptions = useMemo(() => Array.from(new Set(rows.map(r => String(r.warehouse ?? '')).filter(Boolean))).map(v => ({ value: v, label: v })), [rows]);
  const visibleRows = useMemo(() => rows.filter(r => (!warehouse || String(r.warehouse ?? '') === warehouse) && (!sku || JSON.stringify(r).toLowerCase().includes(sku.toLowerCase()))), [rows, warehouse, sku]);
  const columns: DataTableColumn<Row>[] = [
    { key: 'name', header: '产品信息', width: 240, render: text('name') },
    { key: 'warehouse', header: '仓库', width: 160, render: text('warehouse') },
    { key: 'supplier', header: '默认供应商', width: 160, render: text('supplier') },
    { key: 'inbound', header: '待入库', width: 110, numeric: true, render: text('inbound') },
    { key: 'fulfillable', header: '可用库存', width: 120, numeric: true, render: text('fulfillable') },
    { key: 'outbound', header: '待出库', width: 110, numeric: true, render: text('outbound') },
  ];
  return (
    <div className="p-4">
      <WimoorFeaturePanel route="/wimoor/warehouse/inventory-report" bridge={bridge} />
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">库存报表</h1><p className="text-xs text-muted">WIMOOR 库存报表迁移（只读对照）：全部仓库/SKU 筛选与待入库、可用库存、待出库明细；完整库存视图见 /amazon/inventory 等价页。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">仓库
            <Select aria-label="全部仓库" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} options={warehouseOptions} placeholder="全部仓库" />
          </label>
          <Input aria-label="请输入SKU" value={sku} placeholder="请输入SKU" onChange={(e) => setSku(e.target.value)} />
        </div>
        <DataTable<Row> columns={columns} rows={applyFeatureFilters(visibleRows)} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无库存报表记录。本页只读，不预置伪造库存。"
          ariaLabel="库存报表" />
      </section>
    </div>
  );
}
