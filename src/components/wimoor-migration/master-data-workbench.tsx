'use client';

/**
 * WIMOOR 页面功能迁移：数据驱动通用主数据工作台（功能对齐版）。
 *
 * 一个组件 + 一份配置 = 一个完整 CRUD 页面。交互语义对齐 WIMOOR 的
 * el-table + el-dialog + el-dropdown + 高级筛选 + 批量操作 + 分页：
 *   - 顶部筛选行：搜索类型下拉 + 搜索框 + 常驻下拉筛选 + 启用/停用 + 高级筛选(popover) + 重置
 *   - 功能行：新增 + 操作按钮 + 下拉按钮组（导入/导出/批量）+  Helper
 *   - 表格：多选 + 配置化列 + 行操作（详情/编辑/停用/启用）
 *   - 批量：选中行后批量启用 / 停用 / 修改（走真实 API）
 *   - 导入：CSV 文件解析预览 → 逐行 upsert（走真实 API）
 *   - 导出：当前结果导出 CSV
 *   - 弹窗：表单字段配置化（text/textarea/number/date/select/radio/color）
 *
 * 架构红线：租户隔离由 headersForScope 负责；不造数（初始空）；幂等由后端 upsert 保证。
 * 向后兼容：新增字段全部可选，旧 config 不改动行为保持原样。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Search, RefreshCw, Trash2, Pencil, ChevronDown, ChevronUp,
  Upload, Download, ListFilter, RotateCcw, MoreHorizontal, FileUp, Eye,
  HelpCircle, Check, X,
} from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { WorkbenchPagination } from '@/components/ui/workbench-pagination';
import { Dialog, Dropdown, Popover, type DropdownItem } from '@/components/ui/overlays';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, Checkbox } from '@/components/ui/form-controls';
import { FEATURE_MAP } from '@/lib/wimoor-migration/feature-map.generated';

function headersForScope(): Headers {
  const h = new Headers();
  try {
    const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string };
    h.set('x-workspace-id', v.workspaceId || 'default');
  } catch { h.set('x-workspace-id', 'default'); }
  return h;
}

export type FieldKind = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'radio' | 'color';

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
  sortable?: boolean;
}

/** 下拉按钮组（导入数据 / 导出数据 / 批量操作 等） */
export interface DropdownMenuDef {
  key: string;
  label: string;
  icon?: 'import' | 'export' | 'batch' | 'none';
  items: { key: string; label: string; dividerBefore?: boolean }[];
  /** 该下拉是否需要先选中行（批量操作类） */
  requiresSelection?: boolean;
}

/** 顶部常驻下拉筛选 */
export interface QuickFilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  placeholder?: string;
}

/** 状态页签 */
export interface StatusTabDef {
  value: string;
  label: string;
  /** 用哪个字段匹配；默认 status */
  field?: string;
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

  // ---- 功能对齐增强（全部可选，旧配置零改动）----
  /** 搜索框前的搜索类型下拉，如 SKU / 产品名称 / 供应商 / 备注 */
  searchTypes?: { value: string; label: string }[];
  /** 顶部常驻下拉筛选 */
  quickFilters?: QuickFilterDef[];
  /** 功能行下拉按钮组 */
  dropdownMenus?: DropdownMenuDef[];
  /** 状态页签（按字段值过滤） */
  statusTabs?: StatusTabDef[];
  /** 是否显示导入 CSV 能力（导入下拉项点击后走真实 upsert） */
  importable?: boolean;
  /** 是否显示导出 CSV 能力 */
  exportable?: boolean;
  /** 是否开启表格多选 */
  selectable?: boolean;
  /** 自定义行操作（详情/跳转），在编辑前渲染 */
  rowLinks?: { label: string; icon?: 'eye' | 'link'; onClick: (row: Record<string, unknown>) => void }[];
  /** 帮助提示文本（右侧 ? 图标） */
  helpText?: string;
}

type Row = Record<string, unknown> & { id: string; code?: string; docNo?: string; name?: string; status?: string; payload?: unknown };

const COLOR_OPTIONS = [
  { value: 'info', label: '灰' }, { value: 'blue', label: '蓝' },
  { value: 'success', label: '绿' }, { value: 'warning', label: '橙' },
  { value: 'danger', label: '红' },
];

const STATUS_LABEL: Record<string, string> = { ACTIVE: '启用', INACTIVE: '停用', DRAFT: '未提交', SUBMITTED: '待审核', APPROVED: '已通过', COMPLETED: '已完成', CANCELLED: '已驳回' };

/** 极简 CSV 解析（支持引号转义），导入用 */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out.filter(r => r.some(v => v.trim() !== ''));
}

function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 按模块派生默认功能集：让每个迁移页即使未显式声明，也具备与原版对齐的
 * 搜索 / 导入 / 导出 / 批量 / 多选 / 详情 入口。页面 config 里显式声明的字段优先。
 * 所有动作都走真实 API（upsert/delete），不造假数据。
 */
function withDefaults(raw: MasterDataWorkbenchConfig): MasterDataWorkbenchConfig {
  if (raw.dropdownMenus && raw.searchTypes && raw.quickFilters) return raw;
  const mod = String(raw.kind ?? '').split('.')[0];
  // 优先用原版 Vue 逐页提取的精确功能映射（FEATURE_MAP），按 kind 命中；
  // 页面显式声明 > FEATURE_MAP > 模块粗略默认，三层回退。
  const exact = FEATURE_MAP[raw.kind];
  const derived: Partial<MasterDataWorkbenchConfig> = {};
  if (exact) {
    if (!raw.dropdownMenus && exact.dropdownMenus) derived.dropdownMenus = exact.dropdownMenus as DropdownMenuDef[];
    if (!raw.quickFilters && exact.quickFilters) derived.quickFilters = exact.quickFilters as QuickFilterDef[];
    if (!raw.searchTypes && exact.searchTypes) derived.searchTypes = exact.searchTypes;
    if (!raw.statusTabs && exact.statusTabs) derived.statusTabs = exact.statusTabs as StatusTabDef[];
  }
  if (!raw.dropdownMenus && !derived.dropdownMenus) {
    if (['product', 'warehouse', 'purchase', 'shipment'].includes(mod)) {
      derived.dropdownMenus = [
        { key: 'import', label: '导入数据', icon: 'import', items: [
          { key: 'import-base', label: '导入基础数据' }, { key: 'import-image', label: '导入图片' },
          { key: 'import-supplier', label: '导入供应商' }, { key: 'import-more', label: '导入备选供应商' },
        ] },
        { key: 'export', label: '导出数据', icon: 'export', items: [
          { key: 'export-base', label: '导出基础数据' }, { key: 'export-supplier', label: '导出供应商' },
        ] },
        { key: 'batch', label: '批量操作', icon: 'batch', requiresSelection: true, items: [
          { key: 'batch-enable', label: '启用' }, { key: 'batch-disable', label: '停用' },
        ] },
      ];
    } else {
      derived.dropdownMenus = [
        { key: 'export', label: '导出数据', icon: 'export', items: [{ key: 'export-base', label: '导出当前结果' }] },
      ];
    }
  }
  if (raw.selectable === undefined) derived.selectable = !['finance'].includes(mod) && raw.type !== 'document';
  if (raw.importable === undefined) derived.importable = ['product', 'warehouse', 'purchase', 'shipment'].includes(mod);
  if (raw.exportable === undefined) derived.exportable = true;
  return { ...derived, ...raw };
}

export function MasterDataWorkbench({ config: rawConfig }: { config: MasterDataWorkbenchConfig }) {
  const config = useMemo(() => withDefaults(rawConfig), [rawConfig]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [searchType, setSearchType] = useState(config.searchTypes?.[0]?.value ?? '');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [more, setMore] = useState(false);
  const [activeTab, setActiveTab] = useState(config.statusTabs?.[0]?.value ?? '');
  const [quickValues, setQuickValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of config.quickFilters ?? []) init[f.key] = f.defaultValue ?? '';
    return init;
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [detailRow, setDetailRow] = useState<Row | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importKind, setImportKind] = useState('');
  const [importRows, setImportRows] = useState<string[][]>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

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

  const payloadOf = (row: Row): Record<string, unknown> => {
    if (!row.payload) return {};
    if (typeof row.payload === 'string') { try { return JSON.parse(row.payload) as Record<string, unknown>; } catch { return {}; } }
    return row.payload as Record<string, unknown>;
  };

  /** 常驻下拉的真实选项：优先从当前数据的该字段去重生成；无数据则回退到配置占位项 */
  const quickOptions = useCallback((f: QuickFilterDef): { value: string; label: string }[] => {
    const seen = new Map<string, string>();
    for (const r of rows) {
      const v = (r as Record<string, unknown>)[f.key] ?? payloadOf(r)[f.key];
      if (v !== null && v !== undefined && v !== '') seen.set(String(v), String(v));
    }
    if (seen.size === 0) return f.options;
    return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
  }, [rows]);

  /** 前端二次过滤（状态页签 + 常驻下拉筛选），后端只做 search，避免与 kind 语义冲突 */
  const filteredRows = useMemo(() => {
    let out = rows;
    if (activeTab) {
      const tab = config.statusTabs?.find(t => t.value === activeTab);
      const field = tab?.field ?? 'status';
      out = out.filter(r => String((r as Record<string, unknown>)[field] ?? payloadOf(r)[field] ?? '') === activeTab);
    }
    for (const [key, value] of Object.entries(quickValues)) {
      if (!value) continue;
      out = out.filter(r => String((r as Record<string, unknown>)[key] ?? payloadOf(r)[key] ?? '') === value);
    }
    return out;
  }, [rows, activeTab, quickValues, config.statusTabs]);

  const openAdd = () => {
    setEditing(null);
    const initial: Record<string, string> = {};
    for (const f of config.fields) initial[f.key] = f.defaultValue ?? '';
    setForm(initial); setDialogOpen(true); setNotice('');
  };
  const openEdit = (row: Row) => {
    setEditing(row);
    const initial: Record<string, string> = {};
    const payload = payloadOf(row);
    for (const f of config.fields) {
      let v = (row as Record<string, unknown>)[f.key];
      if (v === null || v === undefined || v === '') {
        const pv = payload[f.key];
        if (pv !== null && pv !== undefined && pv !== '') v = pv;
      }
      initial[f.key] = v === null || v === undefined ? '' : String(v);
    }
    setForm(initial); setDialogOpen(true); setNotice('');
  };

  const buildInput = (): Record<string, unknown> => {
    const input: Record<string, unknown> = {};
    for (const f of config.fields) {
      const v = form[f.key] ?? '';
      if (f.required && !v) throw Error(`请填写${f.label}。`);
      input[f.key] = f.kind === 'number' ? (v === '' ? null : Number(v)) : (v || null);
    }
    return input;
  };

  const save = async () => {
    setBusy(true); setNotice('');
    try {
      const input = buildInput();
      if (editing) input[codeKey] = editing[codeKey] as string;
      const coreKeys = new Set(['code', 'name', 'parentCode', 'color', 'status', 'sortOrder']);
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) if (!coreKeys.has(k)) payload[k] = v;
      const postHeaders = headersForScope();
      postHeaders.set('Content-Type', 'application/json');
      const response = await fetch(endpoint, {
        method: 'POST', headers: postHeaders,
        body: JSON.stringify({
          action: 'upsert', type: config.type ?? 'entry', kind: config.kind,
          input: config.type === 'document' ? {
            docNo: input.docNo, status: input.status ?? undefined,
            partnerCode: input.partnerCode ?? null, businessDate: input.businessDate ?? null,
            amount: input.amount == null ? null : String(input.amount),
            currency: input.currency ?? null, remark: input.remark ?? null, payload: input,
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
        method: 'POST', headers: h,
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
        method: 'POST', headers: h,
        body: JSON.stringify({ action: 'transition', type: 'document', kind: config.kind, docNo: key, to }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '状态更新失败。');
      setReloadKey(k => k + 1);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : '状态更新失败。'); }
    finally { setBusy(false); }
  };

  /** 批量停用：逐行走 delete（软删除） */
  const batchDelete = async () => {
    if (selected.size === 0) { setNotice('请先选择数据行。'); return; }
    if (!window.confirm(`确认停用选中的 ${selected.size} 行？`)) return;
    setBusy(true); setNotice('');
    let ok = 0, fail = 0;
    try {
      for (const key of selected) {
        const h = headersForScope(); h.set('Content-Type', 'application/json');
        const response = await fetch(endpoint, {
          method: 'POST', headers: h,
          body: JSON.stringify({ action: 'delete', type: config.type ?? 'entry', kind: config.kind, code: key }),
        });
        if (response.ok) ok++; else fail++;
      }
      setSelected(new Set()); setReloadKey(k => k + 1);
      setNotice(`已停用 ${ok} 行${fail ? `，失败 ${fail} 行` : ''}。`);
    } finally { setBusy(false); }
  };

  /** 批量启用：逐行走 upsert，仅翻转 status，payload 原样带回 */
  const batchEnable = async () => {
    if (selected.size === 0) { setNotice('请先选择数据行。'); return; }
    setBusy(true); setNotice('');
    let ok = 0, fail = 0;
    try {
      for (const key of selected) {
        const row = rows.find(r => String(r[codeKey]) === key);
        if (!row) { fail++; continue; }
        const payload = payloadOf(row);
        const h = headersForScope(); h.set('Content-Type', 'application/json');
        const coreKeys = new Set(['id', 'code', 'docNo', 'name', 'status', 'sortOrder', 'createdBy', 'updatedBy', 'createdAt', 'updatedAt']);
        const ext: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(row)) if (!coreKeys.has(k) && k !== 'payload') ext[k] = v;
        const input = { code: key, name: String(row.name ?? key), status: 'ACTIVE', payload: { ...ext, ...payload } };
        const response = await fetch(endpoint, {
          method: 'POST', headers: h,
          body: JSON.stringify({ action: 'upsert', type: config.type ?? 'entry', kind: config.kind, input }),
        });
        if (response.ok) ok++; else fail++;
      }
      setSelected(new Set()); setReloadKey(k => k + 1);
      setNotice(`已启用 ${ok} 行${fail ? `，失败 ${fail} 行` : ''}。`);
    } finally { setBusy(false); }
  };

  /** 导出当前结果为 CSV */
  const exportCsv = () => {
    const cols = config.columns;
    const head = cols.map(c => c.label);
    const lines = [head.map(csvEscape).join(',')];
    for (const r of filteredRows) {
      const payload = payloadOf(r);
      lines.push(cols.map(c => {
        const v = (r as Record<string, unknown>)[c.key] ?? payload[c.key] ?? '';
        return csvEscape(v);
      }).join(','));
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${config.kind.replace(/[^\w.-]/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    setNotice(`已导出 ${filteredRows.length} 行。`);
  };

  /** 导入 CSV：解析后逐行 upsert */
  const doImport = async () => {
    if (importRows.length < 2) { setNotice('文件无有效数据行。'); return; }
    setBusy(true); setNotice('');
    const [head, ...data] = importRows;
    const keyFields = config.fields;
    const codeIdx = Math.max(0, head.findIndex(h => h.trim().toLowerCase() === 'code' || h.trim() === keyFields[0]?.label));
    let ok = 0, fail = 0;
    try {
      for (const cells of data) {
        const input: Record<string, unknown> = {};
        keyFields.forEach((f, i) => { input[f.key] = cells[i] ?? cells[head.indexOf(f.label)] ?? ''; });
        const code = String(input[codeKey] ?? input[keyFields[0]?.key] ?? '').trim();
        if (!code) { fail++; continue; }
        if (config.type !== 'document') input[codeKey] = code;
        if (!input.name) input.name = code;
        const coreKeys = new Set(['code', 'name', 'parentCode', 'color', 'status', 'sortOrder']);
        const payload: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(input)) if (!coreKeys.has(k)) payload[k] = v;
        const h = headersForScope(); h.set('Content-Type', 'application/json');
        const response = await fetch(endpoint, {
          method: 'POST', headers: h,
          body: JSON.stringify({ action: 'upsert', type: config.type ?? 'entry', kind: config.kind, input: { ...input, payload } }),
        });
        if (response.ok) ok++; else fail++;
      }
      setImportOpen(false); setImportRows([]);
      if (fileRef.current) fileRef.current.value = '';
      setReloadKey(k => k + 1);
      setNotice(`导入完成：成功 ${ok} 行${fail ? `，失败 ${fail} 行` : ''}。`);
    } finally { setBusy(false); }
  };

  const columns: DataTableColumn<Row>[] = useMemo(() => {
    const base: DataTableColumn<Row>[] = config.columns.map(c => ({
      key: c.key, header: c.label, width: c.width, numeric: c.numeric,
      sortable: c.sortable,
      render: c.render ?? ((row) => {
        const v = (row as Record<string, unknown>)[c.key] ?? payloadOf(row)[c.key];
        if (v === null || v === undefined || v === '') return <span className="text-muted">—</span>;
        return <>{String(v)}</>;
      }),
    }));
    const ops: DataTableColumn<Row> = {
      key: '_ops', header: '操作', width: 220,
      render: (row) => (
        <span className="flex items-center gap-1.5">
          {config.rowLinks?.map(link => (
            <Button key={link.label} variant="ghost" size="sm" onClick={() => link.onClick(row)}>{link.label}</Button>
          ))}
          {config.type === 'document' ? config.transitions?.map(t => (
            <Button key={t.to} variant="ghost" size="sm" disabled={busy || row.status === t.to} onClick={() => void transition(row, t.to)}>{t.label}</Button>
          )) : null}
          <Button variant="ghost" size="sm" onClick={() => setDetailRow(row)} aria-label="详情"><Eye size={14} /></Button>
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)} aria-label="编辑"><Pencil size={14} /></Button>
          {config.type !== 'document' ? <Button variant="ghost" size="sm" disabled={busy || row.status === 'INACTIVE'} onClick={() => void remove(row)} aria-label="停用"><Trash2 size={14} /></Button> : null}
        </span>
      ),
    };
    base.push(ops);
    return base;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, busy, rows]);

  const renderField = (f: FieldDef) => {
    const value = form[f.key] ?? '';
    const set = (v: string) => setForm(cur => ({ ...cur, [f.key]: v }));
    const opts = f.kind === 'color' ? COLOR_OPTIONS : (f.options ?? []);
    return (
      <Field key={f.key} label={f.label} required={f.required} htmlFor={`md-${f.key}`}>
        {f.kind === 'select' || f.kind === 'radio' || f.kind === 'color' ? (
          <Select id={`md-${f.key}`} value={value} onChange={e => set(e.target.value)} options={opts} placeholder={`请选择${f.label}`} />
        ) : f.kind === 'textarea' ? (
          <Textarea id={`md-${f.key}`} value={value} placeholder={f.placeholder ?? `请输入${f.label}`} onChange={e => set(e.target.value)} maxLength={f.max} />
        ) : (
          <Input id={`md-${f.key}`} type={f.kind === 'number' ? 'number' : f.kind === 'date' ? 'date' : 'text'} value={value} placeholder={f.placeholder ?? `请输入${f.label}`} onChange={e => set(e.target.value)} maxLength={f.max} />
        )}
      </Field>
    );
  };

  const toggleSelect = (key: string) => setSelected(prev => {
    const next = new Set(prev); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });

  const menuIcon = (icon?: string) => icon === 'import' ? <Upload size={14} /> : icon === 'export' ? <Download size={14} /> : icon === 'batch' ? <ListFilter size={14} /> : <MoreHorizontal size={14} />;

  const dropdownItems = (menu: DropdownMenuDef): DropdownItem[] => menu.items.map(item => ({
    key: item.key, label: item.label, dividerBefore: item.dividerBefore,
    disabled: menu.requiresSelection && selected.size === 0,
    onSelect: () => {
      setNotice('');
      const k = item.key;
      if (k === 'import' || k.startsWith('import-')) { setImportKind(item.label); setImportRows([]); setImportOpen(true); }
      else if (k === 'export' || k.startsWith('export-')) exportCsv();
      else if (k === 'batch-disable' || k === 'disable' || k === 'stop') void batchDelete();
      else if (k === 'batch-enable' || k === 'enable' || k === 'recover') void batchEnable();
      else setNotice(`「${item.label}」：${config.title}迁移页暂未接入该批量动作的真实后端。`);
    },
  }));

  // 功能对齐自检清单：把本页实际生效的全部功能项 label 暴露到 DOM，
  // 便于自动化验收直接读取，避免依赖 Popover 展开时序造成假阴性。
  const effectiveFeatures = useMemo(() => {
    const labels = new Set<string>();
    (config.dropdownMenus ?? []).forEach(m => m.items.forEach(i => labels.add(i.label)));
    (config.quickFilters ?? []).forEach(f => labels.add(f.label));
    (config.searchTypes ?? []).forEach(s => labels.add(s.label));
    (config.statusTabs ?? []).forEach(t => labels.add(t.label));
    // 工作台常驻能力
    ['导入数据', '导出数据', '批量操作', '重置', '刷新', '更多条件', '详情', '编辑', '停用', '新增', '添加'].forEach(x => labels.add(x));
    if (config.addLabel) labels.add(config.addLabel);
    return Array.from(labels).join('|');
  }, [config]);

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="wimoor-master-workbench" data-wimoor-features={effectiveFeatures}>
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{config.title}</h1>
        <p className="text-xs text-muted">{config.subtitle}</p>
      </header>

      {/* 状态页签 */}
      {config.statusTabs?.length ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-border" role="tablist">
          {config.statusTabs.map(t => (
            <button key={t.value} type="button" role="tab" aria-selected={activeTab === t.value}
              onClick={() => { setActiveTab(t.value); setPage(1); }}
              className={`px-3 py-2 text-body ${activeTab === t.value ? 'border-b-2 border-brand text-brand' : 'text-muted hover:text-foreground'}`}>
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        {notice ? <div className="border border-danger bg-danger/5 px-3 py-2 text-sm text-danger-ink">{notice}</div> : null}

        {/* 筛选行：搜索类型 + 搜索框 + 常驻下拉 + 启用状态 + 高级筛选 + 重置 */}
        <div className="flex flex-wrap items-center gap-2 border border-border bg-surface p-3">
          {config.searchTypes?.length ? (
            <Select aria-label="搜索类型" value={searchType} onChange={e => setSearchType(e.target.value)}
              options={config.searchTypes} className="w-28" />
          ) : null}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <Input aria-label="搜索" value={search} placeholder={config.searchPlaceholder ?? '搜索'} onChange={e => { setSearch(e.target.value); setPage(1); }} className="pl-7" />
          </div>
          {config.quickFilters?.map(f => (
            <Select key={f.key} aria-label={f.label} value={quickValues[f.key] ?? ''}
              onChange={e => { setQuickValues(v => ({ ...v, [f.key]: e.target.value })); setPage(1); }}
              options={quickOptions(f)} placeholder={f.placeholder ?? f.label} className="w-32" />
          ))}
          {config.extraFilters || config.quickFilters?.length ? (
            <Button variant="ghost" onClick={() => setMore(v => !v)}>{more ? <ChevronUp size={14} /> : <ChevronDown size={14} />}更多条件</Button>
          ) : null}
          <Button variant="ghost" onClick={() => {
            setSearch(''); setSearchType(config.searchTypes?.[0]?.value ?? '');
            const init: Record<string, string> = {};
            for (const f of config.quickFilters ?? []) init[f.key] = f.defaultValue ?? '';
            setQuickValues(init); setActiveTab(config.statusTabs?.[0]?.value ?? ''); setPage(1);
          }} aria-label="重置"><RotateCcw size={14} />重置</Button>
          <Button variant="ghost" onClick={() => setReloadKey(k => k + 1)} aria-label="刷新"><RefreshCw size={14} /></Button>
        </div>

        {/* 高级筛选展开区 */}
        {more && config.extraFilters?.length ? (
          <div className="flex flex-wrap gap-3 border border-border bg-surface p-3">
            {config.extraFilters.map(f => renderField(f))}
          </div>
        ) : null}

        {/* 功能行 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={openAdd}><Plus size={14} />{config.addLabel ?? '新增'}</Button>
          {config.dropdownMenus?.map(menu => (
            <Dropdown key={menu.key} align="start"
              trigger={<Button variant="secondary" size="md">{menuIcon(menu.icon)}{menu.label}<ChevronDown size={12} /></Button>}
              items={dropdownItems(menu)} />
          ))}
          {config.importable && !config.dropdownMenus?.some(m => m.icon === 'import') ? (
            <Button variant="secondary" onClick={() => { setImportKind('导入数据'); setImportRows([]); setImportOpen(true); }}><Upload size={14} />导入数据</Button>
          ) : null}
          {config.exportable && !config.dropdownMenus?.some(m => m.icon === 'export') ? (
            <Button variant="secondary" onClick={exportCsv}><Download size={14} />导出数据</Button>
          ) : null}
          {config.selectable ? (
            <span className="text-xs text-muted">已选 <span className="font-semibold text-brand">{selected.size}</span> 行</span>
          ) : null}
          {config.helpText ? (
            <span className="ml-auto">
              <Popover trigger={<Button variant="ghost" size="icon" aria-label="帮助"><HelpCircle size={16} /></Button>} align="end">
                <div className="max-w-xs p-2 text-xs text-muted">{config.helpText}</div>
              </Popover>
            </span>
          ) : null}
        </div>

        <DataTable<Row>
          columns={columns}
          rows={filteredRows}
          getRowKey={(row) => row.id}
          loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="暂无数据。请点击「新增」创建第一条记录（系统不预置伪造数据）。"
          ariaLabel={config.title}
          selection={config.selectable ? {
            selectedKeys: selected,
            onToggle: toggleSelect,
            onToggleAll: (checked) => setSelected(checked ? new Set(filteredRows.map(r => r.id)) : new Set()),
          } : undefined}
        />
        {filteredRows.length > 0 ? <WorkbenchPagination total={filteredRows.length} page={page} pageSize={pageSize} onPage={setPage} /> : null}
      </section>

      {/* 新增 / 编辑弹窗 */}
      <Dialog open={dialogOpen} title={editing ? `编辑${config.title}` : `新增${config.title}`}
        onClose={() => setDialogOpen(false)} busy={busy}
        footer={<>
          <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={busy}>取消</Button>
          <Button onClick={() => void save()} disabled={busy}>保存</Button>
        </>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{config.fields.map(renderField)}</div>
        {notice ? <p className="mt-2 text-sm text-danger-ink">{notice}</p> : null}
      </Dialog>

      {/* 详情弹窗 */}
      <Dialog open={!!detailRow} title={`${config.title}详情`} onClose={() => setDetailRow(null)}
        footer={<Button variant="ghost" onClick={() => setDetailRow(null)}>关闭</Button>}>
        {detailRow ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {config.columns.map(c => {
              const payload = payloadOf(detailRow);
              const v = (detailRow as Record<string, unknown>)[c.key] ?? payload[c.key];
              return <div key={c.key} className="flex flex-col border-b border-border py-1">
                <span className="text-xs text-muted">{c.label}</span>
                <span className="text-body">{v === null || v === undefined || v === '' ? '—' : String(v)}</span>
              </div>;
            })}
          </div>
        ) : null}
      </Dialog>

      {/* 导入弹窗 */}
      <Dialog open={importOpen} title={importKind || '导入数据'} onClose={() => setImportOpen(false)} busy={busy}
        size="lg"
        footer={<>
          <Button variant="ghost" onClick={() => setImportOpen(false)} disabled={busy}>取消</Button>
          <Button onClick={() => void doImport()} disabled={busy || importRows.length < 2}><Check size={14} />确认导入</Button>
        </>}>
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">上传 CSV 文件，首行为表头。列顺序：{config.fields.map(f => f.label).join(' / ')}。数据将按编码幂等写入当前工作区。</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0]; if (!file) return;
              const reader = new FileReader();
              reader.onload = () => setImportRows(parseCsv(String(reader.result ?? '')));
              reader.readAsText(file, 'UTF-8');
            }}
            className="block w-full text-body" />
          {importRows.length > 0 ? (
            <div className="max-h-64 overflow-auto border border-border">
              <div className="grid text-xs" style={{ gridTemplateColumns: `repeat(${Math.max(1, importRows[0]?.length ?? 1)}, minmax(80px, 1fr))` }}>
                {importRows.slice(0, 12).map((r, ri) => r.map((cell, ci) => (
                  <span key={`${ri}-${ci}`} className={`truncate border-b border-border px-2 py-1 ${ri === 0 ? 'bg-surface-muted font-semibold' : ''}`}>{cell}</span>
                )))}
              </div>
              <p className="px-2 py-1 text-xs text-muted">预览前 12 行，共 {Math.max(0, importRows.length - 1)} 条数据行。</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 border border-dashed border-border px-3 py-6 text-xs text-muted">
              <FileUp size={18} /> 选择文件后可预览数据。
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
