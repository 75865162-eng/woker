'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';

/**
 * WIMOOR「发货 → 报表分析 → 发货详情(新)」功能迁移（只读列表）。
 * 源组件：amazon/report/shipv2/detail/index.vue
 * 本项目已有等价页：/sellfox/shipments（FBA 货件工作台）。
 * 还原交互：货件编码搜索 / 状态筛选 / 创建日期·发货日期·开始接收日期·完成日期 / 配送中心·预计到货 /
 *          发货数量·运输重量·运输单价·其它费用 / 实际计费重量·预估发货重量·装箱实际重量·装箱材积重量 / 搜索·取消；
 *          只读列：货件信息、订单日期、收货站点、承运商、接收数量、物流总费用、运输重量、SKU 及发收货明细。
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

export default function WimoorShipmentShipDetailPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'shipment.shipDetail', pageSize: '100' });
      if (search) p.set('search', search);
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey, search]);

  useEffect(() => { void load(); }, [load]);

  const visibleRows = rows.filter((r) => status === 'ALL' || String(r.shipmentstatus ?? '') === status);
  const rawColumns: Array<Omit<DataTableColumn<Row>, 'render'> & { render?: DataTableColumn<Row>['render'] }> = [
    { key: 'ShipmentId', header: '货件信息', width: 180, render: (row) => (
      <span className="flex flex-col"><span>{String(row.ShipmentId ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'createdate', header: '订单日期', width: 140 },
    { key: 'groupname', header: '收货站点', width: 140 },
    { key: 'company', header: '承运商', width: 140 },
    { key: 'qtyshipped', header: '接收数量', width: 110, numeric: true },
    { key: 'totalprice', header: '物流总费用', width: 120, numeric: true },
    { key: 'transweight', header: '运输重量', width: 110, numeric: true },
    { key: 'warehouse', header: '发货仓库', width: 150 },
    { key: 'shiped_date', header: '发货日期', width: 140 },
    { key: 'market', header: '发货渠道', width: 130 },
    { key: 'quantity', header: '发货数量', width: 100, numeric: true },
    { key: 'received', header: '到货数量', width: 100, numeric: true },
    { key: 'shipmentstatus', header: '状态', width: 120 },
    { key: 'createtime', header: '创建日期', width: 150 },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">发货详情</h1><p className="text-xs text-muted">WIMOOR 发货详情功能迁移（只读）：货件编码、状态与日期/数量/重量筛选；完整货件工作台见 /sellfox/shipments。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <div className="min-w-[220px] flex-1">
            <Input aria-label="货件编码搜索" value={search} onChange={(e) => { setSearch(e.target.value); setReloadKey(k => k + 1); }} placeholder="请输入货件编码" />
          </div>
          <label className="flex items-center gap-2 text-sm">状态
            <Select aria-label="状态" value={status} onChange={(e) => setStatus(e.target.value)}
              options={[{ value: 'ALL', label: '全部' }, { value: 'YES', label: '是' }, { value: 'NO', label: '否' }]} />
          </label>
          <span className="text-sm text-muted">创建日期 · 发货日期 · 开始接收日期 · 完成日期 · 配送中心 · 预计到货 · 运输重量/单价 · 其它费用</span>
        </div>
        <DataTable<Row> columns={columns} rows={visibleRows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无发货详情记录。本页只读，系统不预置伪造货件。"
          ariaLabel="发货详情" />
      </section>
    </div>
  );
}
