'use client';

/**
 * WIMOOR 页面功能迁移：数据驱动通用主数据工作台。
 *
 * 一个组件 + 一份配置 = 一个完整 CRUD 页面（搜索/筛选/表格/分页/新增/编辑/停用）。
 * 交互语义对齐 WIMOOR 的 el-table + el-dialog + pagination：
 *   - 顶部工具栏：搜索框（防抖）、新增按钮、更多筛选展开
 *   - 表格：配置化列、行操作（编辑/停用）
 *   - 分页：翻页
 *   - 弹窗：表单字段配置化（text/select/radio/color/date/number）
 *
 * 架构红线：租户隔离由 headersForScope 负责；不造数（初始空）；幂等由后端 upsert 保证。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Search, RefreshCw, Trash2, Pencil, ChevronDown, ChevronUp } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { WorkbenchPagination } from '@/components/ui/workbench-pagination';
import { Dialog } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/form-controls';

function headersForScope(): Headers {
  const h = new Headers();
  try {
    const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string };
    h.set('x-workspace-id', v.workspaceId || 'default');
  } catch { h.set('x-workspace-id', 'default'); }
  return h;
}

export type FieldKind = 'text' | 'number' | 'date' | 'select' | 'radio' | 'color';

export interface FieldDef {
  key: string;
  label: string;
  kind?: FieldKind;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  defaultValue?: string;
  max?: number;
}

export interface ColumnDef {
  key: string;
  label: string;
  width?: number;
  render?: (row: Record<string, unknown>) => React.ReactNode;
  numeric?: boolean;
}

export interface MasterDataWorkbenchConfig {
  kind: string;
  title: string;
  subtitle: string;
  addLabel?: string;
  searchPlaceholder?: string;
  /** 主从模式：父级列表按 parentCode 过滤，左侧展示父级分组 */
  parentKind?: string;
  columns: ColumnDef[];
  fields: FieldDef[];
  /** 额外筛选字段（展开"更多条件"里） */
  extraFilters?: FieldDef[];
  type?: 'entry' | 'document';
  /** 单据状态流转动作 */
  transitions?: { to: string; label: string }[];
}

type Row = Record<string, unknown> & { id: string; code?: string; docNo?: string; name?: string; status?: string };

const COLOR_OPTIONS = [
  { value: 'info', label: '灰' }, { value: 'blue', label: '蓝' },
  { value: 'success', label: '绿' }, { value: 'warning', label: '橙' }, { value: 'danger', label: '红' },
];

export function MasterDataWorkbench({ config }: { config: MasterDataWorkbenchConfig }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [more, setMore] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  const endpoint = '/api/wimoor/master-data';
  const codeKey = config.type === 'document' ? 'docNo' : 'code';

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({
        type: config.type ?? 'entry', kind: config.kind,
        page: String(page), pageSize: String(pageSize),
      });
      if (search) p.set('search', search);
      const response = await fetch(`${endpoint}?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setRows((result.rows ?? []) as Row[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
    finally { setLoading(false); }
  }, [config.kind, config.type, page, pageSize, search, reloadKey]);

  useEffect(() => { void load(); }, [load]);

  const openAdd = () => {
    setEditing(null);
    const initial: Record<string, string> = {};
    for (const f of config.fields) initial[f.key] = f.defaultValue ?? '';
    setForm(initial); setDialogOpen(true); setNotice('');
  };
  const openEdit = (row: Row) => {
    setEditing(row);
    const initial: Record<string, string> = {};
    const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>;
    for (const f of config.fields) {
      // 顶层字段优先（code/name/status/sortOrder 等），其次 payload 扩展字段
      let v = row[f.key];
      if (v === null || v === undefined || v === '') {
        const pv = payload[f.key];
        if (pv !== null && pv !== undefined && pv !== '') v = pv;
      }
      initial[f.key] = v === null || v === undefined ? '' : String(v);
    }
    setForm(initial); setDialogOpen(true); setNotice('');
  };

  const save = async () => {
    setBusy(true); setNotice('');
    try {
      const input: Record<string, unknown> = {};
      for (const f of config.fields) {
        const v = form[f.key] ?? '';
        if (f.required && !v) throw Error(`请填写${f.label}。`);
        input[f.key] = f.kind === 'number' ? (v === '' ? null : Number(v)) : (v || null);
      }
      if (editing) {
        const key = editing[codeKey] as string;
        input[codeKey] = key;
      }
      // entry：核心字段走顶层，其余字段放 payload（否则 service 只持久化核心字段，扩展列读不回）
      const coreKeys = new Set(['code', 'name', 'parentCode', 'color', 'status', 'sortOrder']);
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) if (!coreKeys.has(k)) payload[k] = v;
      const postHeaders = headersForScope();
      postHeaders.set('Content-Type', 'application/json');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: postHeaders,
        body: JSON.stringify({
          action: 'upsert', type: config.type ?? 'entry', kind: config.kind,
          input: config.type === 'document' ? {
            docNo: input.docNo, status: input.status ?? undefined,
            partnerCode: input.partnerCode ?? null, businessDate: input.businessDate ?? null,
            amount: input.amount == null ? null : String(input.amount),
            currency: input.currency ?? null, remark: input.remark ?? null,
            payload: input,
          } : { ...input, payload },
        }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '保存失败。');
      setDialogOpen(false); setReloadKey(k => k + 1);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '保存失败。'); }
    finally { setBusy(false); }
  };

  const remove = async (row: Row) => {
    const key = row[codeKey] as string;
    if (!key || !window.confirm(`确认停用「${row.name ?? key}」？此操作保留历史引用。`)) return;
    setBusy(true); setNotice('');
    try {
      const h = headersForScope(); h.set('Content-Type', 'application/json');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ action: 'delete', type: config.type ?? 'entry', kind: config.kind, code: key }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '停用失败。');
      setReloadKey(k => k + 1);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '停用失败。'); }
    finally { setBusy(false); }
  };

  const transition = async (row: Row, to: string) => {
    const key = row[codeKey] as string;
    setBusy(true); setNotice('');
    try {
      const h = headersForScope(); h.set('Content-Type', 'application/json');
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: h,
        body: JSON.stringify({ action: 'transition', type: 'document', kind: config.kind, docNo: key, to }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '状态更新失败。');
      setReloadKey(k => k + 1);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '状态更新失败。'); }
    finally { setBusy(false); }
  };

  const columns: DataTableColumn<Row>[] = useMemo(() => {
    const base: DataTableColumn<Row>[] = config.columns.map(c => ({
      key: c.key, header: c.label, width: c.width, numeric: c.numeric,
      render: c.render ?? ((row) => {
        const v = row[c.key];
        if (v === null || v === undefined || v === '') return <span className="text-muted">—</span>;
        return <>{String(v)}</>;
      }),
    }));
    base.push({
      key: '_ops', header: '操作', width: 160,
      render: (row) => (
        <span className="flex items-center gap-2">
          {config.transitions?.map(t => (
            <Button key={t.to} variant="ghost" size="sm" disabled={busy || row.status === t.to} onClick={() => void transition(row, t.to)}>{t.label}</Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)} aria-label="编辑"><Pencil size={14} /></Button>
          {config.type !== 'document' ? <Button variant="ghost" size="sm" disabled={busy || row.status === 'INACTIVE'} onClick={() => void remove(row)} aria-label="停用"><Trash2 size={14} /></Button> : null}
        </span>
      ),
    });
    return base;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, busy]);

  const renderField = (f: FieldDef) => {
    const value = form[f.key] ?? '';
    const set = (v: string) => setForm(cur => ({ ...cur, [f.key]: v }));
    const opts = f.kind === 'color' ? COLOR_OPTIONS : (f.options ?? []);
    return (
      <Field key={f.key} label={f.label} required={f.required} htmlFor={`md-${f.key}`}>
        {f.kind === 'select' || f.kind === 'radio' || f.kind === 'color' ? (
          <Select id={`md-${f.key}`} value={value} onChange={e => set(e.target.value)} options={opts} placeholder={`请选择${f.label}`} />
        ) : (
          <Input id={`md-${f.key}`} type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'} value={value} placeholder={f.placeholder ?? `请输入${f.label}`} onChange={e => set(e.target.value)} maxLength={f.max} />
        )}
      </Field>
    );
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* 页面标题区。外壳/导航/鉴权由 (erp)/layout.tsx 的 WorkspaceShell 提供，此处不再嵌套服务端 AppShell。 */}
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{config.title}</h1>
        <p className="text-xs text-muted">{config.subtitle}</p>
      </header>
      <section className="flex flex-col gap-3">
        {notice ? <div className="border border-danger bg-danger/5 px-3 py-2 text-sm text-danger-ink">{notice}</div> : null}
        <div className="flex flex-wrap items-center gap-2 border border-border bg-surface p-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <Input aria-label="搜索" value={search} placeholder={config.searchPlaceholder ?? '搜索'} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-7" />
          </div>
          <Button onClick={openAdd}><Plus size={14} />{config.addLabel ?? '新增'}</Button>
          <Button variant="ghost" onClick={() => setReloadKey(k => k + 1)} aria-label="刷新"><RefreshCw size={14} /></Button>
          {config.extraFilters?.length ? (
            <Button variant="ghost" onClick={() => setMore(v => !v)}>{more ? <ChevronUp size={14} /> : <ChevronDown size={14} />}更多条件</Button>
          ) : null}
        </div>
        {more && config.extraFilters ? (
          <div className="flex flex-wrap gap-3 border border-border bg-surface p-3">
            {config.extraFilters.map(f => renderField(f))}
          </div>
        ) : null}
        <DataTable<Row>
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无数据。请点击「新增」创建第一条记录（系统不预置伪造数据）。"
          ariaLabel={config.title}
        />
        {rows.length > 0 ? <WorkbenchPagination total={rows.length} page={page} pageSize={pageSize} onPage={setPage} /> : null}
      </section>

      <Dialog
        open={dialogOpen}
        title={editing ? `编辑${config.title}` : `新增${config.title}`}
        onClose={() => setDialogOpen(false)}
        busy={busy}
        footer={<>
          <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>取消</Button>
          <Button onClick={() => void save()} disabled={busy}>保存</Button>
        </>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{config.fields.map(renderField)}</div>
        {notice ? <p className="mt-2 text-sm text-danger-ink">{notice}</p> : null}
      </Dialog>
    </div>
  );
}
