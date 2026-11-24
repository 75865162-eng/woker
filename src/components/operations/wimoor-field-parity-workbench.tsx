'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StandardDataTable } from '@/components/ui/table-variants';
import { type DataTableColumn } from '@/components/ui/data-table';
import { ListPageTemplate } from '@/components/templates/page-templates';
import { StatusPill, type StatusTone } from '@/components/ui/status-pill';

type CoverageState = 'explicit' | 'extractable' | 'derived' | 'pending-data' | 'pending-decision';
type Priority = 'P0' | 'P1' | 'P2' | '-';
type FieldRow = {
  label: string; prop: string; modelField: string; spapi: string;
  state: CoverageState; priority: Priority; note: string; valueCheck: boolean;
  pageLabel?: string;
};
type Group = { page: string; pageLabel: string; wimoorRoute: string; count: number };
type Summary = {
  coverage: Record<CoverageState, number>;
  priority: Record<Priority, number>;
  implementedRatio: number;
  total: number;
};
type Basis = { formula: string; source: string; specialCase?: string };
type Result = {
  groups: Group[];
  fields: FieldRow[];
  stateLabels: Record<CoverageState, string>;
  summary: Summary;
  formulaBasis: { ads: Record<string, Basis>; profit: Basis; traffic: Basis };
  extractGroups: Array<{ domain: string; count: number; specs: Array<{ canonical: string; wimoorProp: string; spapiElement: string; aliases: string[] }> }>;
  provenance: Record<string, string>;
};

const STATE_TONE: Record<CoverageState, StatusTone> = {
  explicit: 'success',
  extractable: 'info',
  derived: 'brand',
  'pending-data': 'warning',
  'pending-decision': 'danger',
};

function headersForScope(): Headers {
  const h = new Headers();
  try { const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; h.set('x-workspace-id', v.workspaceId || 'default'); }
  catch { h.set('x-workspace-id', 'default'); }
  return h;
}

export function WimoorFieldParityWorkbench() {
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [group, setGroup] = useState('');
  const [state, setState] = useState('');
  const [priority, setPriority] = useState('');
  const [showFormula, setShowFormula] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams();
      if (group) p.set('group', group);
      if (state) p.set('state', state);
      if (priority) p.set('priority', priority);
      const q = p.toString();
      const response = await fetch(`/api/operations/wimoor-field-parity${q ? `?${q}` : ''}`, { headers: headersForScope(), cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json() as Result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setLoading(false); }
  }, [group, state, priority]);

  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (data?.fields ?? []).map((f, i) => ({ ...f, _key: `${i}:${f.prop}` })), [data]);
  const stateLabels = data?.stateLabels;

  const columns: Array<DataTableColumn<(typeof rows)[number]>> = [
    { key: 'priority', header: '级', width: 44, render: r => <span className={r.priority === 'P0' ? 'font-semibold text-danger-ink' : r.priority === 'P1' ? 'text-warning-ink' : 'text-muted'}>{r.priority === '-' ? '—' : r.priority}</span> },
    { key: 'label', header: 'Wimoor 列', width: 140, render: r => <span title={r.prop}>{r.label}</span> },
    { key: 'state', header: '覆盖状态', width: 112, render: r => <StatusPill tone={STATE_TONE[r.state]}>{stateLabels?.[r.state] ?? r.state}</StatusPill> },
    { key: 'modelField', header: '本项目模型.字段', width: 240, render: r => <span className="text-xs text-muted" title={r.modelField}>{r.modelField}</span> },
    { key: 'spapi', header: 'SP-API 元素', width: 220, render: r => <span className="text-xs text-muted" title={r.spapi}>{r.spapi}</span> },
    { key: 'note', header: '差距 / 核验动作', width: 300, render: r => <span className="text-xs" title={r.note}>{r.note}{r.valueCheck ? ' ⏳' : ''}</span> },
  ];

  const cov = data?.summary.coverage;
  const pri = data?.summary.priority;
  const basis = data?.formulaBasis;

  return <div data-testid="wimoor-field-parity-workbench">
    <ListPageTemplate
      header={<div className="space-y-2">
        <p className="text-body text-muted">
          静态字段级对标（Wimoor ↔ 本项目 ↔ SP-API）。派生指标按 Wimoor 源码实证公式实现；
          待拍板 / 待数据项仅标注激活条件，<strong>不生成业务值</strong>。⏳ 表示取值一致性待迁移+真实数据后复核。
        </p>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {data && <span data-testid="parity-ratio">已覆盖 <strong>{data.summary.implementedRatio}%</strong>（{data.summary.total} 字段）</span>}
          {cov && <span>显式 {cov.explicit} · 可提取 {cov.extractable} · 派生 {cov.derived} · 待数据 {cov['pending-data']} · 待拍板 {cov['pending-decision']}</span>}
          {pri && <span>缺口 P0 {pri.P0} · P1 {pri.P1} · P2 {pri.P2}</span>}
          <button type="button" className="rounded border border-border px-2 py-1" onClick={() => setShowFormula(v => !v)}>{showFormula ? '收起' : '查看'}派生口径与出处</button>
          <button type="button" className="h-8 rounded border border-border bg-background px-2" onClick={() => void load()} disabled={loading}>{loading ? '读取中…' : '刷新'}</button>
        </div>
        {showFormula && basis && <div className="space-y-1 rounded border border-border bg-surface p-2 text-xs text-muted">
          <p><strong>广告（Wimoor Mapper.xml）</strong></p>
          {Object.entries(basis.ads).map(([k, v]) => <p key={k} className="pl-2">{k} = {v.formula} <span className="opacity-70">[{v.source}]{v.specialCase ? ` · ${v.specialCase}` : ''}</span></p>)}
          <p className="pt-1"><strong>利润（Wimoor ServiceImpl）</strong></p>
          <p className="pl-2">{basis.profit.formula} <span className="opacity-70">[{basis.profit.source}]</span></p>
          <p className="pt-1"><strong>流量比率</strong>：{basis.traffic.formula} <span className="opacity-70">[{basis.traffic.source}]</span></p>
        </div>}
        {error && <p role="alert" className="text-sm text-danger-ink">读取失败：{error}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-center gap-2 border-b border-border pb-4">
        <select aria-label="按页面筛选" className="h-9 rounded border border-border bg-background px-2 text-sm" value={group} onChange={e => setGroup(e.target.value)}>
          <option value="">全部页面</option>
          {(data?.groups ?? []).map(g => <option key={g.page} value={g.page}>{g.pageLabel}（{g.count}）</option>)}
        </select>
        <select aria-label="按状态筛选" className="h-9 rounded border border-border bg-background px-2 text-sm" value={state} onChange={e => setState(e.target.value)}>
          <option value="">全部状态</option>
          {Object.entries(stateLabels ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select aria-label="按优先级筛选" className="h-9 rounded border border-border bg-background px-2 text-sm" value={priority} onChange={e => setPriority(e.target.value)}>
          <option value="">全部优先级</option>
          <option value="P0">P0</option><option value="P1">P1</option><option value="P2">P2</option>
        </select>
      </section>}
      table={<StandardDataTable
        ariaLabel="Wimoor 字段对标矩阵"
        rows={rows}
        getRowKey={r => r._key}
        columns={columns}
        empty={loading ? '读取中…' : '无匹配字段。'}
      />}
    />
    {data?.provenance && <div className="mt-2 space-y-0.5 text-xs text-muted">
      <p>映射文档：{data.provenance.mappingDoc} · 基线 HEAD {data.provenance.mappingHead} · Wimoor 快照 {data.provenance.wimoorSnapshot}</p>
      <p>派生口径：{data.provenance.derivedFormulas}</p>
      <p>{data.provenance.caveat}</p>
    </div>}
  </div>;
}
