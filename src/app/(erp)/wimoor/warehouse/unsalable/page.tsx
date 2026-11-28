'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/form-controls';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';
import { useReadOnlyListFeatureBridge } from '@/components/wimoor-migration/use-readonly-list-feature-bridge';

/**
 * WIMOOR「仓库 → 报表 → 本地滞销」功能迁移（只读对照入口）。
 * 源组件：erp/warehouse/inventory/report/unsalable/index.vue
 * 本项目已有等价页：/wms 库龄分析与 /amazon/inventory；本页只做轻量对照。
 * 还原交互：SKU 搜索 / 图片、当前库存、库龄分段(0~30/30~60/60~90/90~180/180~365/365+)、
 *          出库数量分段(30/60/90天)、冗余库存只读列 / 导出、导出超长库龄、下载语义。
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
export default function WimoorWarehouseUnsalablePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const { bridge, applyFeatureFilters } = useReadOnlyListFeatureBridge(rows);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [sku, setSku] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'warehouse.unsalable', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);
  useEffect(() => { void load(); }, [load]);
  const visibleRows = useMemo(() => rows.filter(r => !sku || String(r.sku ?? '').toLowerCase().includes(sku.toLowerCase())), [rows, sku]);
  const columns: DataTableColumn<Row>[] = [
    { key: 'image', header: '图片', width: 80, render: text('image') },
    { key: 'sku', header: '产品信息', width: 200, render: text('sku') },
    { key: 'qtysum', header: '当前库存', width: 120, numeric: true, render: text('qtysum') },
    { key: 'age', header: '库龄', width: 110, render: text('age') },
    { key: 'qtysum0', header: '0~30天', width: 110, numeric: true, render: text('qtysum0') },
    { key: 'qtysum30', header: '30~60天', width: 110, numeric: true, render: text('qtysum30') },
    { key: 'qtysum60', header: '60~90天', width: 110, numeric: true, render: text('qtysum60') },
    { key: 'qtysum90', header: '90~180天', width: 110, numeric: true, render: text('qtysum90') },
    { key: 'qtysum180', header: '180~365天', width: 120, numeric: true, render: text('qtysum180') },
    { key: 'qtysum365', header: '365天以上', width: 120, numeric: true, render: text('qtysum365') },
    { key: 'salesum30', header: '30天出库', width: 110, numeric: true, render: text('salesum30') },
    { key: 'salesum60', header: '60天出库', width: 110, numeric: true, render: text('salesum60') },
    { key: 'salesum90', header: '90天出库', width: 110, numeric: true, render: text('salesum90') },
    { key: 'nowinv90', header: '冗余库存', width: 120, numeric: true, render: text('nowinv90') },
  ];
  return (
    <div className="p-4">
      <WimoorFeaturePanel route="/wimoor/warehouse/unsalable" bridge={bridge} />
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">本地滞销</h1><p className="text-xs text-muted">WIMOOR 本地滞销迁移（只读对照）：SKU 筛选与库龄分段、出库分段、冗余库存；完整分析见 /wms 库龄工作台。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <Input aria-label="请输入SKU" value={sku} placeholder="请输入SKU" onChange={(e) => setSku(e.target.value)} />
          <span className="text-sm text-muted">导出/导出超长库龄/下载为外部文件动作，本页只读</span>
        </div>
        <DataTable<Row> columns={columns} rows={applyFeatureFilters(visibleRows)} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无本地滞销记录。本页只读，不预置伪造库龄数据。"
          ariaLabel="本地滞销" />
      </section>
    </div>
  );
}
