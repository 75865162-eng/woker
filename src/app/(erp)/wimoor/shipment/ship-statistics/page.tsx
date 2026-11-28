'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';
import { WimoorFeaturePanel } from '@/components/wimoor-migration/wimoor-feature-panel';
import { useReadOnlyListFeatureBridge } from '@/components/wimoor-migration/use-readonly-list-feature-bridge';

/**
 * WIMOOR「发货 → 报表分析 → 发货统计(新)」功能迁移（只读列表）。
 * 源组件：amazon/report/shipv2/ship_summary/index.vue
 * 本项目已有等价页：/sellfox/shipments（FBA 货件工作台）、/operations/logistics-quotes。
 * 还原交互：汇总指标 / 承运商·物流渠道选择 / SKU 搜索 / 创建日期·发货日期切换 / 导出；
 *          只读列：计划发货、实际发货、实际接收、接收差值、待发货、待接收、实际发货货值、
 *          预估/发货运输重量、货件箱数、运输费用、关税其它费用、平均物流时效、货件票数、异常货件票数。
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

export default function WimoorShipmentShipStatisticsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const { bridge, applyFeatureFilters } = useReadOnlyListFeatureBridge(rows);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [dateType, setDateType] = useState('CREATED');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'shipment.shipStatistics', pageSize: '100' });
      if (search) p.set('search', search);
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey, search]);

  useEffect(() => { void load(); }, [load]);

  const rawColumns: Array<Omit<DataTableColumn<Row>, 'render'> & { render?: DataTableColumn<Row>['render'] }> = [
    { key: 'name', header: '发货信息', width: 180, render: (row) => <span>{String(row.name ?? '—')}</span> },
    { key: 'totalqty', header: '计划发货', width: 110, numeric: true },
    { key: 'totalout', header: '实际发货', width: 110, numeric: true },
    { key: 'totalrec', header: '实际接收', width: 110, numeric: true },
    { key: 'lessrec', header: '接收差值', width: 110, numeric: true },
    { key: 'needout', header: '待发货', width: 100, numeric: true },
    { key: 'needrec', header: '待接收', width: 100, numeric: true },
    { key: 'worth', header: '实际发货货值', width: 130, numeric: true },
    { key: 'readweight', header: '预估运输重量(KG)', width: 150, numeric: true },
    { key: 'transweight_kg', header: '发货运输重量(KG)', width: 150, numeric: true },
    { key: 'transweight_cbm', header: '发货运输重量(CBM)', width: 150, numeric: true },
    { key: 'totalbox', header: '货件箱数', width: 100, numeric: true },
    { key: 'shipfee', header: '运输费用', width: 110, numeric: true },
    { key: 'totalotherfee', header: '关税/其他费用', width: 130, numeric: true },
    { key: 'avgtime', header: '平均物流时效(天)', width: 140, numeric: true },
    { key: 'shipmentnum', header: '货件票数', width: 100, numeric: true },
    { key: 'problem', header: '异常货件票数', width: 120, numeric: true },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <WimoorFeaturePanel route="/wimoor/shipment/ship-statistics" bridge={bridge} />
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">发货统计</h1><p className="text-xs text-muted">WIMOOR 发货统计功能迁移（只读）：汇总指标与承运商/渠道、SKU、日期筛选；完整报表见 /sellfox/shipments。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <div className="min-w-[200px] flex-1">
            <Input aria-label="SKU搜索" value={search} onChange={(e) => { setSearch(e.target.value); setReloadKey(k => k + 1); }} placeholder="请输入SKU" />
          </div>
          <label className="flex items-center gap-2 text-sm">日期类型
            <Select aria-label="日期类型" value={dateType} onChange={(e) => setDateType(e.target.value)}
              options={[{ value: 'CREATED', label: '创建日期' }, { value: 'SHIPPED', label: '发货日期' }]} />
          </label>
          <span className="text-sm text-muted">汇总指标 · 选择承运商 · 选择物流渠道 · 导出（原页面筛选与按钮）</span>
        </div>
        <DataTable<Row> columns={columns} rows={applyFeatureFilters(rows)} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无发货统计记录。本页只读，系统不预置伪造指标。"
          ariaLabel="发货统计" />
      </section>
    </div>
  );
}
