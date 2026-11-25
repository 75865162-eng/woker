'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/form-controls';

/**
 * WIMOOR「广告 → 广告报表 → 广告统计」功能迁移（只读列表）。
 * 源组件：amazon/advertisement/overview/index.vue
 * 本项目已有等价页：/amazon-ads（Amazon 广告持久工作台，含漏斗/ROAS 排名/统计图表）、/sellfox/ads（CPC 报表）。
 * 还原交互：商品广告/关键词切换、昨日变动/连续变动/同期变动切换、广告活动/广告组/广告/投放数量与
 *          曝光/点击/转化率/ACOS 预警指标的只读展示；仅读取，不提供造数或写入。
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

const WARNING_LABELS: Record<string, string> = {
  yesterday: '昨日变动', sequent: '连续变动', co: '同期变动',
};

export default function WimoorAdsSummaryPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [wareDataType, setWareDataType] = useState('productads');
  const [warningType, setWarningType] = useState('co');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({ type: 'entry', kind: 'ads.summary', pageSize: '100' });
      const response = await fetch(`/api/wimoor/master-data?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [reloadKey]);

  useEffect(() => { void load(); }, [load]);

  const visibleRows = useMemo(
    () => rows.filter((r) => !r.type || String(r.type) === wareDataType),
    [rows, wareDataType],
  );

  const columns: DataTableColumn<Row>[] = [
    { key: 'name', header: '指标', width: 220, render: (row) => <span>{String(row.name ?? '—')}</span> },
    { key: 'status', header: '指标类别', width: 150, render: (row) => <span className="text-muted">{String(row.metricGroup ?? '—')}</span> },
    { key: 'yesterday', header: '昨日变动', width: 130, numeric: true,
      render: (row) => <span className={warningType === 'yesterday' ? 'text-info-ink font-semibold' : ''}>{row.yesterday == null ? '—' : String(row.yesterday)}</span>,
    },
    { key: 'sequent', header: '连续变动', width: 130, numeric: true,
      render: (row) => <span className={warningType === 'sequent' ? 'text-info-ink font-semibold' : ''}>{row.sequent == null ? '—' : String(row.sequent)}</span>,
    },
    { key: 'co', header: '同期变动', width: 130, numeric: true,
      render: (row) => <span className={warningType === 'co' ? 'text-info-ink font-semibold' : ''}>{row.co == null ? '—' : String(row.co)}</span>,
    },
    { key: 'remark', header: '说明', width: 220, render: (row) => <span className="text-muted">{String(row.remark ?? '—')}</span> },
  ];

  return (
    <div className="p-4">
      <header className="flex flex-col gap-1 mb-4"><h1 className="text-lg font-semibold">广告统计</h1><p className="text-xs text-muted">WIMOOR 广告统计功能迁移（只读）：商品广告/关键词维度与昨日/连续/同期预警指标；完整仪表盘见 /amazon-ads 等价页。</p></header>
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
          <label className="flex items-center gap-2 text-sm">
            统计对象
            <Select aria-label="统计对象" value={wareDataType} onChange={(e) => setWareDataType(e.target.value)}
              options={[{ value: 'productads', label: '商品广告' }, { value: 'keywords', label: '关键词' }]} />
          </label>
          <label className="flex items-center gap-2 text-sm">
            变动维度
            <Select aria-label="变动维度" value={warningType} onChange={(e) => setWarningType(e.target.value)}
              options={Object.entries(WARNING_LABELS).map(([value, label]) => ({ value, label }))} />
          </label>
          <span className="text-sm text-muted">当前维度：{WARNING_LABELS[warningType] ?? warningType}</span>
        </div>
        <DataTable<Row>
          columns={columns}
          rows={visibleRows}
          getRowKey={(row) => row.id}
          loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无统计数据。本页只读，系统不预置伪造指标（用户显式创建才有记录）。"
          ariaLabel="广告统计"
        />
      </section>
    </div>
  );
}
