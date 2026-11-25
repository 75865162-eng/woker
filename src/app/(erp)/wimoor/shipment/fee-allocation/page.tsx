'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/form-controls';

/**
 * WIMOOR「发货 → 报表分析 → 费用分摊(新)」功能迁移（只读列表）。
 * 源组件：amazon/report/ship/fee_summary_new/index.vue
 * 本项目已有等价页：/operations/settlement-allocations、/sellfox/shipments。
 * 还原交互：发货人·状态 / 发货日期·到货日期 / 承运商·物流渠道 / SKU材积 / 历史详情 / 导出；
 *          只读列：产品信息、产品负责人、发货信息、物流渠道、货件信息、收货站点、发货数量、
 *          SKU头程费用、平均单件头程费用、实际结算重量、货件运费、SKU费用分摊。
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

export default function WimoorShipmentFeeAllocationPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [dateType, setDateType] = useState('SHIPPED');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'shipment.feeAllocation', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);

  useEffect(() => { void load(); }, [load]);

  const rawColumns: Array<Omit<DataTableColumn<Row>, 'render'> & { render?: DataTableColumn<Row>['render'] }> = [
    { key: 'msku', header: '产品信息', width: 180, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.msku ?? '')}</span></span>
    ) },
    { key: 'ownername', header: '产品负责人', width: 130 },
    { key: 'warehouse', header: '发货信息', width: 150 },
    { key: 'channame', header: '物流渠道', width: 140 },
    { key: 'ShipmentId', header: '货件信息', width: 160 },
    { key: 'groupname', header: '收货站点', width: 130 },
    { key: 'qty', header: '发货数量', width: 100, numeric: true },
    { key: 'skufee', header: 'SKU头程费用(元)', width: 140, numeric: true },
    { key: 'avgfee', header: '平均单件头程费用(元)', width: 160, numeric: true },
    { key: 'transweight', header: '实际结算重量', width: 120, numeric: true },
    { key: 'shipmentfee', header: '货件运费(元)', width: 120, numeric: true },
    { key: 'allocated', header: 'SKU费用分摊', width: 130, numeric: true },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">费用分摊</h1><p className="text-xs text-muted">WIMOOR 费用分摊功能迁移（只读）：发货人/状态、日期类型、承运商/渠道与材积筛选；完整分摊见 /operations/settlement-allocations。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">日期类型
            <Select aria-label="日期类型" value={dateType} onChange={(e) => setDateType(e.target.value)}
              options={[{ value: 'SHIPPED', label: '发货日期' }, { value: 'ARRIVED', label: '到货日期' }]} />
          </label>
          <span className="text-sm text-muted">发货人 · 状态 · 选择承运商 · 选择物流渠道 · SKU材积 · 历史详情 · 导出（原页面筛选与按钮）</span>
        </div>
        <DataTable<Row> columns={columns} rows={rows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无费用分摊记录。本页只读，系统不预置伪造费用。"
          ariaLabel="费用分摊" />
      </section>
    </div>
  );
}
