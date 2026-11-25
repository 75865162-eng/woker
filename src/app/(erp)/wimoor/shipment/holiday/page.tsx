'use client';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/form-controls';

/**
 * WIMOOR「发货 → 发货管理 → 发货日历」功能迁移（只读对照入口）。
 * 源组件：sys/holiday/index.vue
 * 还原交互：年份选择 / 生成年度日历按钮；源页面为日历视图（无表格列配置），本页以只读列表承载日期记录。
 * 说明：本项目无独立日历模块等价页，本页仅读取用户显式创建的日期数据，不生成伪造节假日。
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

const YEAR_OPTIONS = [
  { value: '2024', label: '2024' }, { value: '2025', label: '2025' },
  { value: '2026', label: '2026' }, { value: '2027', label: '2027' },
];

export default function WimoorShipmentHolidayPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [year, setYear] = useState('2026');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'shipment.holiday', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);

  useEffect(() => { void load(); }, [load]);

  const visibleRows = rows.filter((r) => !r.year || String(r.year) === year);
  const rawColumns: Array<Omit<DataTableColumn<Row>, 'render'> & { render?: DataTableColumn<Row>['render'] }> = [
    { key: 'date', header: '日期', width: 150 },
    { key: 'name', header: '名称', width: 220 },
    { key: 'type', header: '类型', width: 140 },
    { key: 'remark', header: '备注', width: 220 },
  ];
  const columns: DataTableColumn<Row>[] = rawColumns.map((c) => ({
    ...c,
    render: c.render ?? ((row) => row[c.key] == null || row[c.key] === '' ? <span className="text-muted">—</span> : <>{String(row[c.key])}</>),
  }));

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">发货日历</h1><p className="text-xs text-muted">WIMOOR 发货日历功能迁移（只读）：年份筛选与年度日历记录；原页面为日历视图，源交互“生成年度日历”为写入操作，本页不代用户生成。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">年份
            <Select aria-label="年份" value={year} onChange={(e) => setYear(e.target.value)} options={YEAR_OPTIONS} />
          </label>
          <span className="text-sm text-muted">生成年度日历（原页面按钮，本页只读不触发）</span>
        </div>
        <DataTable<Row> columns={columns} rows={visibleRows} getRowKey={(row) => row.id} loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无该年度日历记录。本页只读，系统不预置伪造节假日。"
          ariaLabel="发货日历" />
      </section>
    </div>
  );
}
