'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Preview = { kind: string; id: string; sourceKey: string; currency: string; sourceDate: string; fingerprint: string; lines: Array<{ account: string; debit: string; credit: string }> };
type Subject = { id: string; code: string; name: string; enabled: boolean; leaf: boolean };
const inputClass = 'h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
export function FinanceSourceImport({ periodId, subjects, headers, onSaved }: { periodId: string; subjects: Subject[]; headers: () => Headers; onSaved: () => Promise<void> }) {
  const initialSource = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  const initialKind = initialSource?.get('sourceKind');
  const [kind, setKind] = useState(initialKind === 'WMS_OVERSEAS_CHARGE' || initialKind === 'FX_REVALUATION' || initialKind === 'WMS_COMMAND' || initialKind === 'WMS_INVENTORY_RISK' || initialKind === 'WMS_COST_ADJUSTMENT' || initialKind === 'PURCHASE_PAYMENT' || initialKind === 'PURCHASE_REFUND' ? initialKind : 'FBA_ADJUSTMENT'), [id, setId] = useState(initialSource?.get('sourceId') ?? '');
  const [preview, setPreview] = useState<Preview | null>(null), [mapping, setMapping] = useState<Record<string, string>>({});
  const [date, setDate] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);
  function reset() { generation.current++; setPreview(null); setMapping({}); setError(''); }
  async function perform(save: boolean) {
    if (busy) return;
    const token = ++generation.current, requestHeaders = headers();
    const workspace = requestHeaders.get('x-workspace-id');
    setBusy(true); setError('');
    const active = () => generation.current === token && headers().get('x-workspace-id') === workspace;
    try {
      const response = await fetch(save ? '/api/operations/finance-ledger/sources' : `/api/operations/finance-ledger/sources?${new URLSearchParams({ kind, id })}`, {
        method: save ? 'POST' : 'GET', headers: requestHeaders, cache: 'no-store',
        ...(save && preview ? { body: JSON.stringify({ kind: preview.kind, id: preview.id, fingerprint: preview.fingerprint, periodId, date, accountMapping: [...new Set(preview.lines.map(line => line.account))].map(sourceAccount => ({ sourceAccount, subjectId: mapping[sourceAccount] })) }) } : {}),
      });
      const result = await response.json();
      if (!active()) return;
      if (!response.ok) throw Error(result.error ?? '核算来源交接失败。');
      if (save) { setPreview(null); setMapping({}); await onSaved(); }
      else { setPreview(result); setDate(result.sourceDate); setMapping({}); }
    } catch (cause) { if (active()) setError(cause instanceof Error ? cause.message : '核算来源交接失败。'); }
    finally { if (generation.current === token) setBusy(false); }
  }
  return <section aria-label="核算来源转入总账" className="space-y-2 border-b border-border pb-4">
    <h2 className="text-sm font-semibold">核算来源转入</h2>
    <p className="text-xs text-muted">预览经复核的采购付款或退款、头程费用调整或已计价的库存来源，映射正式科目后保存总账草稿。</p>
    <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); void perform(false); }}>
      <select aria-label="核算来源类型" className={inputClass} disabled={busy} value={kind} onChange={event => { reset(); setKind(event.target.value); }}><option value="WMS_OVERSEAS_CHARGE">已复核海外调拨运输费用</option><option value="FX_REVALUATION">已复核期末汇兑重估</option><option value="FBA_ADJUSTMENT">头程费用调整草稿</option><option value="WMS_COMMAND">库存计价草稿</option><option value="WMS_INVENTORY_RISK">已复核库存跌价评估</option><option value="WMS_COST_ADJUSTMENT">库存成本调整</option><option value="PURCHASE_PAYMENT">已确认采购付款</option><option value="PURCHASE_REFUND">已确认采购退款</option></select>
      <input aria-label="核算草稿 ID" className={inputClass} required disabled={busy} value={id} onChange={event => { reset(); setId(event.target.value); }} placeholder="核算草稿 ID" />
      <Button size="sm" variant="secondary" disabled={busy}>预览来源</Button>
    </form>
    {preview && <form className="space-y-2" onSubmit={event => { event.preventDefault(); void perform(true); }}>
      <p className="text-xs">{preview.sourceKey} · {preview.currency}</p>
      <div className="grid gap-2 sm:grid-cols-2">{[...new Set(preview.lines.map(line => line.account))].map(account => <label key={account} className="grid gap-1 text-xs">来源科目 {account}<select aria-label={`来源科目 ${account}`} className={inputClass} required disabled={busy} value={mapping[account] ?? ''} onChange={event => setMapping(current => ({ ...current, [account]: event.target.value }))}><option value="">选择正式末级科目</option>{subjects.filter(subject => subject.enabled && subject.leaf).map(subject => <option key={subject.id} value={subject.id}>{subject.code} · {subject.name}</option>)}</select></label>)}</div>
      {preview.lines.map((line, index) => <p key={index} className="text-xs">{line.account} · 借 {line.debit} / 贷 {line.credit}</p>)}
      <label className="flex items-center gap-2 text-xs">会计日期<input aria-label="来源凭证会计日期" className={inputClass} type="date" required disabled={busy || preview.kind === 'PURCHASE_PAYMENT' || preview.kind === 'PURCHASE_REFUND'} value={date} onChange={event => setDate(event.target.value)} />{(preview.kind === 'PURCHASE_PAYMENT' || preview.kind === 'PURCHASE_REFUND') && <span className="text-muted">使用实际收付日期</span>}</label>
      <Button size="sm" disabled={busy}>保存为总账草稿</Button>
    </form>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </section>;
}
