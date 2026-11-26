'use client';

/**
 * WIMOOR 迁移页「亚马逊真实数据只读工作台」。
 *
 * 用于映射表中 status='amazon' 的页面：读取 Amazon SP-API 已同步、已发布的真实数据。
 * 严格只读：不提供新增/编辑/停用/导入/批量按钮，不写 MasterDataEntry，不造数。
 *
 * 数据链路（全部复用成熟实现）：
 *   1) GET /api/operations/amazon-mcp        → scopes（当前用户授权的 sellerAccountId+marketplaceId）
 *   2) GET /api/operations/sync-center?section=data&table=...&sellerAccountId=...&marketplaceId=...
 *      内部 readDataset → querySkillTable，与 MCP data_query 同源；
 *      继承会话校验、workspace 隔离、账号分配收窄、只读已发布数据源、审计。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Select } from '@/components/ui/form-controls';
import { amazonMapForPage, type AmazonPageMapping } from '@/lib/wimoor-migration/page-dataset-map';

type Row = Record<string, unknown> & { id: string };
type ScopeOption = { sellerAccountId: string; marketplaceId: string; displayName?: string };

function headersForScope(): Headers {
  const h = new Headers();
  try {
    const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string };
    h.set('x-workspace-id', v.workspaceId || 'default');
  } catch { h.set('x-workspace-id', 'default'); }
  return h;
}

/** 支持点路径取嵌套字段（如 metrics.sessions），null/undefined → null。 */
function pick(row: Record<string, unknown>, path: string): unknown {
  if (path in row) return row[path] ?? null;
  let cur: unknown = row;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur ?? null;
}

function display(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

const PAGE_SIZE = 50;

export function AmazonDatasetWorkbench({ pageKey, fallbackTitle }: { pageKey: string; fallbackTitle?: string }) {
  const mapping: AmazonPageMapping | null = useMemo(() => amazonMapForPage(pageKey), [pageKey]);
  const [scopes, setScopes] = useState<ScopeOption[]>([]);
  const [scopeIdx, setScopeIdx] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  // 1) 取授权店铺/站点
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/operations/amazon-mcp', { headers: headersForScope(), cache: 'no-store' });
        const j = await r.json();
        if (!r.ok) throw Error(j?.error ?? '读取授权范围失败');
        if (alive) setScopes(Array.isArray(j.scopes) ? j.scopes : []);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : '读取授权范围失败');
      }
    })();
    return () => { alive = false; };
  }, []);

  const scope = scopes[scopeIdx];

  // 2) 读真实数据
  const load = useCallback(async () => {
    if (!mapping) { setLoading(false); return; }
    if (!scope) { setRows([]); setTotal(0); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const p = new URLSearchParams({
        section: 'data', table: mapping.dataset,
        sellerAccountId: scope.sellerAccountId, marketplaceId: scope.marketplaceId,
        page: String(page), pageSize: String(PAGE_SIZE), r: String(reloadKey),
      });
      // pin 固定筛选（如 reportType），防止口径混淆
      for (const [k, v] of Object.entries(mapping.pin ?? {})) {
        if (k === 'fromOffsetDays') continue; // 日期偏移由下方处理
        p.set(k, v);
      }
      const r = await fetch(`/api/operations/sync-center?${p}`, { headers: headersForScope(), cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw Error(j?.error ?? '读取失败');
      const items = j?.records ?? j?.data?.items ?? [];
      setRows(Array.isArray(items) ? items.map((x: Record<string, unknown>, i: number) => ({ ...x, id: String(x.id ?? x.amazonOrderId ?? x.businessDate ?? i) })) : []);
      setTotal(Number(j?.total ?? j?.data?.total ?? 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : '读取失败');
      setRows([]); setTotal(0);
    } finally { setLoading(false); }
  }, [mapping, scope, page, reloadKey]); // reloadKey 作为 cache-buster 参与请求

  useEffect(() => { void load(); }, [load]);

  const columns: DataTableColumn<Row>[] = useMemo(() => {
    if (!mapping) return [];
    return mapping.columns.map(c => ({
      key: c.key,
      header: c.label,
      width: c.width,
      numeric: c.numeric,
      render: (row: Row) => <span className={c.numeric ? 'tabular-nums' : ''}>{display(pick(row, c.key))}</span>,
    }));
  }, [mapping]);

  if (!mapping) return null; // 调用方不应传未映射页；fail-safe

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const scopeLabel = scope ? `${scope.displayName ?? scope.sellerAccountId.slice(0, 8)} · ${scope.marketplaceId}` : '无授权站点';

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="wimoor-amazon-workbench"
      data-wimoor-features="亚马逊真实数据|只读|店铺站点选择|分页|刷新">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{fallbackTitle ?? mapping.name}</h1>
        <p className="text-xs text-muted">WIMOOR {mapping.name} · 只读展示 Amazon 同步真实数据（等价口径见 {mapping.comp}）</p>
      </header>

      <section className="flex flex-wrap items-center gap-3 border border-border bg-surface p-3">
        {scopes.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            店铺/站点
            <Select aria-label="店铺站点" value={String(scopeIdx)} onChange={(e) => { setScopeIdx(Number(e.target.value)); setPage(1); }}
              options={scopes.map((s, i) => ({ value: String(i), label: `${s.displayName ?? s.sellerAccountId.slice(0, 8)} · ${s.marketplaceId}` }))} />
          </label>
        )}
        <span className="text-xs text-muted">当前站点：{scopeLabel}　共 {total} 条真实记录</span>
        <button type="button" onClick={() => setReloadKey(k => k + 1)} className="border border-border px-3 py-1 text-xs hover:bg-surface-muted">刷新</button>
      </section>

      {scopes.length === 0 && !loading && (
        <div className="border border-border bg-surface p-4 text-sm text-muted">
          当前账号没有已授权的亚马逊店铺/站点，未读取任何数据。请先在「设置 → 店铺管理」完成授权。
        </div>
      )}

      {scopes.length > 0 && (
        <DataTable<Row>
          columns={columns}
          rows={rows}
          getRowKey={(row) => row.id}
          loading={loading}
          error={error ? { message: error, onRetry: () => setReloadKey(k => k + 1) } : undefined}
          empty="当前站点暂无该数据集的已发布数据（空不代表业务上不存在）。"
          ariaLabel={mapping.name}
        />
      )}

      {scopes.length > 0 && pageCount > 1 && (
        <div className="flex items-center gap-2 text-xs">
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="border border-border px-2 py-1 disabled:opacity-40">上一页</button>
          <span>第 {page} / {pageCount} 页</span>
          <button type="button" disabled={page >= pageCount} onClick={() => setPage(p => p + 1)} className="border border-border px-2 py-1 disabled:opacity-40">下一页</button>
        </div>
      )}

      <p className="border-t border-border pt-2 text-xs text-muted">数据口径：{mapping.basis}</p>
    </div>
  );
}

export default AmazonDatasetWorkbench;
