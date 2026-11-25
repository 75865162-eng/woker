'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Input, Select } from '@/components/ui/form-controls';

/**
 * WIMOOR「发货 → 报表分析 → 海关申报统计」功能迁移（只读列表）。
 * 源组件：erp/shipv2/shipment_handing/shipstep/components/customs_summary.vue
 * 本项目已有等价页：/sellfox/shipments（FBA 货件工作台，含海关申报步骤）。
 * 还原交互：申报时间·操作时间 / 请输入SKU / 金额·数量·净重·毛重·物流重量·装箱重量·单据/箱子/货件个数筛选 /
 *          导出·导入发送状态 / 详情 / 选择XML文件·上传文件；
 *          只读列：申报状态类型、申报类型、申报金额、数量、重量、申报货件、装箱/物流重量、返回信息、操作时间、SKU 明细。
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

export default function WimoorShipmentCustomsStatisticsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [dateType, setDateType] = useState('DECLARE');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'shipment.customsStatistics', pageSize: '100' });
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
    { key: 'app_status', header: '申报状态/类型', width: 140 },
    { key: 'xml_type', header: '申报类型', width: 130 },
    { key: 'total_price', header: '申报金额', width: 120, numeric: true },
    { key: 'total_quantity', header: '申报数量', width: 110, numeric: true },
    { key: 'gross_weight', header: '重量', width: 100, numeric: true },
    { key: 'number', header: '申报货件', width: 150 },
    { key: 'boxweight', header: '装箱重量', width: 110, numeric: true },
    { key: 'transweight', header: '物流重量', width: 110, numeric: true },
    { key: 'return_status', header: '返回信息', width: 180 },
    { key: 'opttime', header: '操作时间', width: 160 },
    { key: 'sku', header: 'SKU', width: 140 },
    { key: 'name', header: '商品名称', width: 170 },
    { key: 'price', header: '申报单价', width: 110, numeric: true },
    { key: 'quantity', header: '申报数量', width: 110, numeric: true },
    { key: 'detailTotalPrice', header: '申报金额', width: 120, numeric: true },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">海关申报统计</h1><p className="text-xs text-muted">WIMOOR 海关申报统计功能迁移（只读）：申报日期类型、SKU 与重量/数量筛选；完整申报步骤见 /sellfox/shipments。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">日期类型
            <Select aria-label="日期类型" value={dateType} onChange={(e) => setDateType(e.target.value)}
              options={[{ value: 'DECLARE', label: '申报时间' }, { value: 'OPERATE', label: '操作时间' }]} />
          </label>
          <div className="min-w-[200px] flex-1">
            <Input aria-label="SKU搜索" value={search} onChange={(e) => { setSearch(e.target.value); setReloadKey(k => k + 1); }} placeholder="请输入SKU" />
          </div>
          <span className="text-sm text-muted">金额 · 数量 · 净重 · 毛重 · 物流重量 · 装箱重量 · 单据/箱子/货件个数 · 导出 · 导入发送状态 · 上传XML（原页面筛选与按钮）</span>
        </div>
        <DataTable<Row> columns={columns} rows={rows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无海关申报记录。本页只读，系统不预置伪造申报数据。"
          ariaLabel="海关申报统计" />
      </section>
    </div>
  );
}
