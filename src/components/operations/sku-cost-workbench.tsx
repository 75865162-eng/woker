'use client';
import { useCallback, useEffect, useState } from 'react';
import { StandardDataTable } from '@/components/ui/table-variants';
import { type DataTableColumn } from '@/components/ui/data-table';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';
import { ListPageTemplate } from '@/components/templates/page-templates';

type CostItem = {
  id: string; sku: string; asin: string; costCurrency: string;
  purchaseCost: string; freightCost: string; otherCost: string;
  note: string; effectiveAt: string | null; updatedAt: string;
};

function wsId(): string {
  try { const v = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; return v.workspaceId || 'default'; }
  catch { return 'default'; }
}
function scopeHeaders(): Headers { const h = new Headers(); h.set('x-workspace-id', wsId()); return h; }
function postHeaders(): Headers { const h = scopeHeaders(); h.set('Content-Type', 'application/json'); return h; }

const emptyDraft = { sku: '', asin: '', costCurrency: 'CNY', purchaseCost: '0', freightCost: '0', otherCost: '0', note: '', effectiveAt: '' };

const columns: DataTableColumn<CostItem>[] = [
  { key: 'sku', header: 'SKU', width: 150, render: r => r.sku },
  { key: 'asin', header: 'ASIN', width: 110, render: r => r.asin || '—' },
  { key: 'ccy', header: '成本币种', width: 80, render: r => r.costCurrency },
  { key: 'purchase', header: '采购成本', width: 100, render: r => r.purchaseCost },
  { key: 'freight', header: '头程成本', width: 100, render: r => r.freightCost },
  { key: 'other', header: '其他成本', width: 100, render: r => r.otherCost },
  { key: 'note', header: '备注', width: 140, render: r => r.note || '—' },
  { key: 'del', header: '', width: 60, render: r => <button type="button" className="text-xs text-danger-ink underline" onClick={() => void onDelete(r.id)}>删除</button> },
];

// onDelete 由组件内闭包注入（见下方 define）
let onDelete: (id: string) => Promise<void> = async () => {};

export function SkuCostWorkbench() {
  const [items, setItems] = useState<CostItem[]>([]);
  const [draft, setDraft] = useState({ ...emptyDraft });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/operations/amazon-sku-cost', { headers: scopeHeaders(), cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '读取失败。');
      setItems((result.items ?? []) as CostItem[]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败。'); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const reset = () => { setItems([]); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, []);

  const remove = useCallback(async (id: string) => {
    if (busy || !window.confirm('确认删除这条成本记录？')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(`/api/operations/amazon-sku-cost?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: scopeHeaders() });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '删除失败。');
      setNotice('已删除。'); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '删除失败。'); }
    finally { setBusy(false); }
  }, [busy, load]);
  onDelete = remove;

  const save = async () => {
    if (busy) return;
    if (!draft.sku.trim()) { setError('请填写 SKU。'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operations/amazon-sku-cost', {
        method: 'POST', headers: postHeaders(),
        body: JSON.stringify({ items: [draft] }),
      });
      const result = await response.json();
      if (!response.ok) throw Error(result.error ?? '保存失败。');
      setNotice(`已保存 ${result.count ?? 1} 条成本记录。`);
      setDraft({ ...emptyDraft }); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败。'); }
    finally { setBusy(false); }
  };

  const set = (k: keyof typeof draft, v: string) => setDraft(d => ({ ...d, [k]: v }));

  return <div data-testid="sku-cost-workbench">
    <ListPageTemplate
      header={<div className="space-y-1">
        <p className="text-body text-muted">按 SKU + 成本币种录入采购/头程/其他成本（原币），供「SKU 最终利润」按汇率折算。同一 SKU 可按不同币种各录一条。</p>
        {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
        {notice && <p className="text-sm text-success-ink">{notice}</p>}
      </div>}
      filters={<section className="flex flex-wrap items-end gap-2 border-b border-border pb-4">
        <label className="flex flex-col gap-1 text-xs">SKU<input className="h-9 w-40 rounded border border-border bg-background px-2 text-sm" value={draft.sku} onChange={e => set('sku', e.target.value)} placeholder="如 BM-F6FL-K73E" /></label>
        <label className="flex flex-col gap-1 text-xs">ASIN（可选）<input className="h-9 w-32 rounded border border-border bg-background px-2 text-sm" value={draft.asin} onChange={e => set('asin', e.target.value)} placeholder="10 位" /></label>
        <label className="flex flex-col gap-1 text-xs">币种<input className="h-9 w-20 rounded border border-border bg-background px-2 text-sm" value={draft.costCurrency} onChange={e => set('costCurrency', e.target.value.toUpperCase())} placeholder="CNY" /></label>
        <label className="flex flex-col gap-1 text-xs">采购<input className="h-9 w-24 rounded border border-border bg-background px-2 text-sm" value={draft.purchaseCost} onChange={e => set('purchaseCost', e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs">头程<input className="h-9 w-24 rounded border border-border bg-background px-2 text-sm" value={draft.freightCost} onChange={e => set('freightCost', e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs">其他<input className="h-9 w-24 rounded border border-border bg-background px-2 text-sm" value={draft.otherCost} onChange={e => set('otherCost', e.target.value)} /></label>
        <label className="flex flex-col gap-1 text-xs">生效日（可选）<input className="h-9 w-32 rounded border border-border bg-background px-2 text-sm" value={draft.effectiveAt} onChange={e => set('effectiveAt', e.target.value)} placeholder="YYYY-MM-DD" /></label>
        <button type="button" className="h-9 rounded border border-border bg-background px-3 text-sm" onClick={() => void save()} disabled={busy}>{busy ? '保存中…' : '保存成本'}</button>
        <a href="/amazon/fx-rate" className="h-9 rounded border border-border bg-background px-3 text-sm leading-9">去配置汇率</a>
        <a href="/amazon/sku-profit-final" className="h-9 rounded border border-border bg-background px-3 text-sm leading-9">查看最终利润</a>
      </section>}
      table={<StandardDataTable ariaLabel="SKU 成本录入" rows={items} getRowKey={r => r.id} columns={columns} empty="暂无成本记录，请在上方录入。" />}
    />
  </div>;
}
