'use client';
import { useCallback, useEffect, useState } from 'react';
import { StandardDataTable } from '@/components/ui/table-variants';
import { type DataTableColumn } from '@/components/ui/data-table';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';
import { ListPageTemplate } from '@/components/templates/page-templates';

type FxItem = {
  id: string; fromCurrency: string; toCurrency: string; rate: string;
  note: string; effectiveAt: string | null; updatedAt: string;
};

function wsId(): string {
  try { const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; return v.workspaceId || 'default'; }
  catch { return 'default'; }
}
function scopeHeaders(): Headers { const h = new Headers(); h.set('x-workspace-id', wsId()); return h; }
function postHeaders(): Headers { const h = scopeHeaders(); h.set('Content-Type', 'application/json'); return h; }

const emptyDraft = { fromCurrency: 'CNY', toCurrency: 'USD', rate: '', note: '', effectiveAt: '' };

let onDelete: (id: string) => Promise<void> = async () => {};
const columns: DataTableColumn<FxItem>[] = [
  { key: 'pair', header: '币种对', width: 140, render: r => `${r.fromCurrency} → ${r.toCurrency}` },
  { key: 'rate', header: '汇率', width: 120, render: r => r.rate },
  { key: 'effective', header: '生效日', width: 110, render: r => r.effectiveAt ? String(r.effectiveAt).slice(0, 10) : '—' },
  { key: 'note', header: '备注', width: 180, render: r => r.note || '—' },
  { key: 'del', header: '', width: 60, render: r => <button type="button" className="text-xs text-danger-ink underline" onClick={() => void onDelete(r.id)}>删除</button> },
];

export function FxRateWorkbench() {
  const [items, setItems] = useState<FxItem[]>([]);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/operations/amazon-fx-rate', { headers: scopeHeaders(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setItems((result.items ?? []) as FxItem[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setItems([]); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  const remove = useCallback(async (id: string) => {
    if (busy || !window.confirm('确认删除这条汇率配置？')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/operations/amazon-fx-rate?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: scopeHeaders() });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '删除失败。');
      setNotice('已删除。'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败。'); }
    finally { setBusy(false); }
  }, [busy, load]);
  onDelete = remove;

  const save = async () => {
    if (busy) return;
    if (!draft.rate.trim()) { setError('请填写汇率。'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operations/amazon-fx-rate', {
        method: 'POST', headers: postHeaders(), body: JSON.stringify({ items: [draft] }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '保存失败。');
      setNotice(`已保存 ${result.count ?? 1} 条汇率。`);
      setDraft({ ...emptyDraft, fromCurrency: draft.fromCurrency, toCurrency: draft.toCurrency }); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。'); }
    finally { setBusy(false); }
  };

  const set = (k: keyof typeof draft, v: string) => setDraft(d => ({ ...d, [k]: v }));

  return <div data-testid="fx-rate-workbench">
    <ListPageTemplate
      header={<div className="space-y-1">
        <p className="text-body text-muted">录入「成本币种 → 结算币种」汇率（如 1 CNY = 0.14 USD 则填 0.14）。系统<strong>不自动抓汇率</strong>，未配置的币种对在最终利润中留空不造数。</p>
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        {notice && <p className="text-sm text-success-ink">{notice}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="flex flex-col gap-1 text-xs">从（成本币种）<input className="h-9 w-28 rounded border border-border bg-background px-2 text-sm" value={draft.fromCurrency} onChange={e => set('fromCurrency', e.target.value.toUpperCase())} /></label>
        <label className="flex flex-col gap-1 text-xs">到（结算币种）<input className="h-9 w-28 rounded border border-border bg-background px-2 text-sm" value={draft.toCurrency} onChange={e => set('toCurrency', e.target.value.toUpperCase())} /></label>
        <label className="flex flex-col gap-1 text-xs">汇率<input className="h-9 w-28 rounded border border-border bg-background px-2 text-sm" value={draft.rate} onChange={e => set('rate', e.target.value)} placeholder="如 0.14" /></label>
        <label className="flex flex-col gap-1 text-xs">生效日（可选）<input className="h-9 w-32 rounded border border-border bg-background px-2 text-sm" value={draft.effectiveAt} onChange={e => set('effectiveAt', e.target.value)} placeholder="YYYY-MM-DD" /></label>
        <label className="flex flex-col gap-1 text-xs">备注<input className="h-9 w-40 rounded border border-border bg-background px-2 text-sm" value={draft.note} onChange={e => set('note', e.target.value)} /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存汇率'}</button>
        <a href="/amazon/sku-cost" className="h-9 rounded border border-border bg-background px-3 text-sm leading-9">SKU 成本录入</a>
        <a href="/amazon/sku-profit-final" className="h-9 rounded border border-border bg-background px-3 text-sm leading-9">查看最终利润</a>
      </section>}
      table={<StandardDataTable ariaLabel="汇率配置" rows={items} getRowKey={r => r.id} columns={columns} empty="暂无汇率配置，请在上方录入。" />}
    />
  </div>;
}
