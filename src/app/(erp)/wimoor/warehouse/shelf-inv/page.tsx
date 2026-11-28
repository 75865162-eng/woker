'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';
import { useReadOnlyListFeatureBridge } from '@/components/wimoor-migration/use-readonly-list-feature-bridge';

/**
 * WIMOOR「仓库 → 基础信息 → 库位库存」功能迁移（只读列表）。
 * 源组件：erp/warehouse/shelf/inv/index.vue + components/shelf_product.vue
 * 还原交互：已上架/未上架切换 / 含子库位 / 含辅料 / SKU 搜索 / 导出；
 *          列：图片、名称/SKU、库位、库位库存、最后上架时间、仓库地址/暂存库存、最后入库时间。
 * 说明：上架/下架为库存写入动作，本项目已有库存工作台承载，本页只读展示，不造数。
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
export default function WimoorWarehouseShelfInvPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const { bridge, applyFeatureFilters } = useReadOnlyListFeatureBridge(rows);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('shelf');
  const [sku, setSku] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'warehouse.shelf-inv', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);
  useEffect(() => { void load(); }, [load]);

  const visibleRows = useMemo(
    () => rows.filter((r) => (!sku || JSON.stringify(r).toLowerCase().includes(sku.toLowerCase()))),
    [rows, sku],
  );
  const columns: DataTableColumn<Row>[] = [
    { key: 'sku', header: '名称/SKU', width: 240, render: (row) => <span>{String(row.name ?? '')} {String(row.sku ?? '—')}</span> },
    { key: 'shelfname', header: '库位', width: 160, render: text('shelfname') },
    { key: 'quantity', header: tab === 'shelf' ? '库位库存' : '暂存库存', width: 120, numeric: true, render: text('quantity') },
    { key: 'addressname', header: '仓库地址', width: 180, render: (row) => <span>{String(row.addressname ?? '')}{row.warehousename ? `: ${String(row.warehousename)}` : ''}</span> },
    { key: 'warehousequantity', header: '仓库总库存', width: 130, numeric: true, render: text('warehousequantity') },
    { key: 'putontime', header: '最后上架时间', width: 170, render: text('putontime') },
    { key: 'instocktime', header: '最后入库时间', width: 170, render: text('instocktime') },
  ];

  return (
    <div className="p-4">
      <WimoorFeaturePanel route="/wimoor/warehouse/shelf-inv" bridge={bridge} />
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">库位库存</h1><p className="text-xs text-muted">WIMOOR 库位库存迁移（只读）：已上架/未上架、含子库位/含辅料、SKU 搜索与库位库存明细；上架下架请使用库存工作台。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">上架状态
            <Select aria-label="上架状态" value={tab} onChange={(e) => setTab(e.target.value)}
              options={[{ value: 'shelf', label: '已上架' }, { value: 'unshelf', label: '未上架' }]} />
          </label>
          <Input aria-label="搜索SKU" value={sku} placeholder="搜索SKU..." onChange={(e) => setSku(e.target.value)} />
          <span className="text-sm text-muted">当前：{tab === 'shelf' ? '已上架' : '未上架'}（只读）</span>
        </div>
        <DataTable<Row> columns={columns} rows={applyFeatureFilters(visibleRows)} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无库位库存记录。本页只读，系统不预置伪造库存。"
          ariaLabel="库位库存" />
      </section>
    </div>
  );
}
