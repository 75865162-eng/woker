'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input } from '@/components/ui/form-controls';
import { mapAmazonInventoryRows, AMAZON_INVENTORY_PAGE_BASIS, type AmazonInventoryRow } from '@/lib/wimoor-migration/amazon-inventory-adapter';

/**
 * WIMOOR「发货 → 报表分析 → FBA库存」功能迁移（只读列表）。
 * 源组件：amazon/inventory/fba/detail.vue
 * 本项目已有等价页：/amazon/inventory、/sellfox/inventory（库存工作台）。
 * 还原交互：请输入SKU 搜索 / 导出 / 头程费用导入；
 *          只读列：产品信息 / 仓库 / 库存 / 可售 / 预留 / 正在发货 / 待接收 / 正在接收 / 不可用 / 异常 /
 *          安全库存周期 / 最小发货周期 / 头程运输成本，及英德法意西波各站点库存。
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

export default function WimoorShipmentFbaInventoryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');

  const [snapshotStatus, setSnapshotStatus] = useState<string>('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      // 落地页直接读取亚马逊真实库存快照（已发布 run），不再读通用主数据空表。
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
    { key: 'name', header: '产品信息', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'warehouse', header: '仓库', width: 140 },
    { key: 'afnWarehouseQuantity', header: '库存', width: 90, numeric: true },
    { key: 'afnFulfillableQuantity', header: '可售库存', width: 100, numeric: true },
    { key: 'afnReservedQuantity', header: '预留库存', width: 100, numeric: true },
    { key: 'afnInboundWorkingQuantity', header: '正在发货', width: 100, numeric: true },
    { key: 'afnInboundShippedQuantity', header: '待接收', width: 90, numeric: true },
    { key: 'afnInboundReceivingQuantity', header: '正在接收', width: 100, numeric: true },
    { key: 'afnUnsellableQuantity', header: '不可用', width: 90, numeric: true },
    { key: 'afnResearchingQuantity', header: '异常', width: 80, numeric: true },
    { key: 'stockingCycle', header: '安全库存周期', width: 120, numeric: true },
    { key: 'minCycle', header: '最小发货周期', width: 120, numeric: true },
    { key: 'firstLegCharges', header: '头程运输成本', width: 120, numeric: true },
    { key: 'GB', header: '英国', width: 80, numeric: true },
    { key: 'DE', header: '德国', width: 80, numeric: true },
    { key: 'FR', header: '法国', width: 80, numeric: true },
    { key: 'IT', header: '意大利', width: 80, numeric: true },
    { key: 'ES', header: '西班牙', width: 80, numeric: true },
    { key: 'PL', header: '波兰', width: 80, numeric: true },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">FBA库存</h1><p className="text-xs text-muted">WIMOOR FBA库存功能迁移：SKU 搜索与全站点库存指标，数据自动匹配亚马逊已发布库存快照{snapshotStatus ? `（快照：${snapshotStatus}）` : ''}。{AMAZON_INVENTORY_PAGE_BASIS}</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <div className="min-w-[220px] flex-1">
            <Input aria-label="SKU搜索" value={search} onChange={(e) => { setSearch(e.target.value); setReloadKey(k => k + 1); }} placeholder="请输入SKU" />
          </div>
          <span className="text-sm text-muted">导出 · 头程费用导入（原页面按钮，本页只读不触发）</span>
        </div>
        <DataTable<Row> columns={columns} rows={rows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无已发布的亚马逊FBA库存快照。系统不预置伪造库存；请先同步并发布库存数据。"
          ariaLabel="FBA库存" />
      </section>
    </div>
  );
}
