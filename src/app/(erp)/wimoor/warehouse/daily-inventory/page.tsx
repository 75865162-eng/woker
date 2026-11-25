'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';
import { mapAmazonInventoryRows, AMAZON_INVENTORY_PAGE_BASIS, type AmazonInventoryRow } from '@/lib/wimoor-migration/amazon-inventory-adapter';

/**
 * WIMOOR「仓库 → 报表 → 每日库存」功能迁移（只读对照入口）。
 * 源组件：erp/warehouse/inventory/daily/index.vue
 * 本项目已有等价页：/wms 库存快照与 /amazon/inventory；本页只做轻量对照。
 * 还原交互：全部仓库下拉 / SKU 搜索 / 产品信息、仓库、item 只读列 / 导出语义（不生成伪造文件）。
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
export default function WimoorWarehouseDailyInventoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [warehouse, setWarehouse] = useState('');
  const [sku, setSku] = useState('');
  const [snapshotStatus, setSnapshotStatus] = useState<string>('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // 落地页直接读取亚马逊真实库存快照（已发布 run）。
      const p = new URLSearchParams({ page: '1', pageSize: '100' });
      if (sku) p.set('sku', sku);
      const response = await fetch(`/api/operations/inventory/snapshots?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setSnapshotStatus(result.snapshot?.status ?? '');
      setRows(mapAmazonInventoryRows((result.rows ?? []) as AmazonInventoryRow[]) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey, sku]);
  useEffect(() => { void load(); }, [load]);
  const warehouseOptions = useMemo(() => Array.from(new Set(rows.map(r => String(r.warehouse ?? '')).filter(Boolean))).map(v => ({ value: v, label: v })), [rows]);
  const visibleRows = useMemo(() => rows.filter(r => (!warehouse || String(r.warehouse ?? '') === warehouse) && (!sku || JSON.stringify(r).toLowerCase().includes(sku.toLowerCase()))), [rows, warehouse, sku]);
  const columns: DataTableColumn<Row>[] = [
    { key: 'sku', header: '产品信息(SKU)', width: 220, render: text('sku') },
    { key: 'asin', header: 'ASIN', width: 160, render: text('asin') },
    { key: 'warehouse', header: '站点', width: 160, render: text('warehouse') },
    { key: 'afnFulfillableQuantity', header: '可售', width: 100, numeric: true, render: text('afnFulfillableQuantity') },
    { key: 'afnWarehouseQuantity', header: '库存合计', width: 110, numeric: true, render: text('afnWarehouseQuantity') },
  ];
  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">每日库存</h1><p className="text-xs text-muted">WIMOOR 每日库存：站点/SKU 筛选，数据自动匹配亚马逊已发布库存快照{snapshotStatus ? `（快照：${snapshotStatus}）` : ''}。{AMAZON_INVENTORY_PAGE_BASIS}</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">仓库
            <Select aria-label="全部仓库" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} options={warehouseOptions} placeholder="全部仓库" />
          </label>
          <Input aria-label="请输入SKU" value={sku} placeholder="请输入SKU" onChange={(e) => setSku(e.target.value)} />
        </div>
        <DataTable<Row> columns={columns} rows={visibleRows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无已发布的亚马逊库存快照。系统不预置伪造库存；请先同步并发布库存数据。"
          ariaLabel="每日库存" />
      </section>
    </div>
  );
}
