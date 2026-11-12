'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';

type Item = { id: string; bookId: string; voucherId: string; voucher: { sourceKey: string }; subjectId: string; revision: number; counterparty: string; kind: string; currency: string; amount: string; allocated: string; remaining: string; dueDate: string; evidence: string; status: string };
type LedgerData = { truncated?: { items: boolean; settlements: boolean }; items: Item[]; settlements: Array<{ id: string; documentId: string; paymentId: string; amount: string; date: string; evidence: string; reversedAt: string | null }> };
const cls = 'h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
const today = new Date().toISOString().slice(0, 10);
const labels: Record<string, string> = { PAYABLE: '应付单据', RECEIVABLE: '应收单据', PAYMENT: '付款', RECEIPT: '收款' };
export function FinanceOpenItems({ bookId, periodId, periodOpen, vouchers, subjects, canCreate, canApprove, headers }: { bookId: string; periodId: string; periodOpen: boolean; vouchers: Array<{ id: string; bookId: string; status: string; sourceKey: string; date: string; lines: Array<{ subjectId: string }> }>; subjects: Array<{ id: string; bookId: string; code: string; name: string; enabled: boolean; leaf: boolean }>; canCreate: boolean; canApprove: boolean; headers: () => Headers }) {
  const [data, setData] = useState<LedgerData>({ items: [], settlements: [] });
  const [kind, setKind] = useState('PAYABLE'), [voucherId, setVoucherId] = useState(''), [subjectId, setSubjectId] = useState(''), [counterparty, setCounterparty] = useState(''), [dueDate, setDueDate] = useState(today), [evidence, setEvidence] = useState('');
  const [documentId, setDocumentId] = useState(''), [paymentId, setPaymentId] = useState(''), [date, setDate] = useState(today), [amount, setAmount] = useState(''), [settlementEvidence, setSettlementEvidence] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    if (!bookId) { setData({ items: [], settlements: [] }); return; }
    const response = await fetch(`/api/operations/finance-open-items?bookId=${encodeURIComponent(bookId)}`, { headers: headers(), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? '往来数据读取失败。');
    setData(result);
  }, [bookId, headers]);
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : '往来数据读取失败。')); }, [load]);
  const postedVouchers = vouchers.filter(row => row.bookId === bookId && row.status === 'POSTED');
  const selectedVoucher = postedVouchers.find(row => row.id === voucherId);
  const eligibleSubjects = subjects.filter(row => row.bookId === bookId && row.enabled && row.leaf && selectedVoucher?.lines.some(line => line.subjectId === row.id));
  const pairings = useMemo(() => data.items.filter(row => row.status === 'OPEN' && row.remaining !== '0.000000'), [data.items]);
  const documents = pairings.filter(row => row.kind === 'PAYABLE' || row.kind === 'RECEIVABLE');
  const selectedPayment = pairings.find(row => row.id === paymentId);
  const selectedDocument = documents.find(row => row.id === documentId);
  const paymentKind = selectedDocument?.kind === 'PAYABLE' ? 'PAYMENT' : 'RECEIPT';
  const payments = pairings.filter(row => selectedDocument && row.kind === paymentKind && row.bookId === selectedDocument.bookId && row.subjectId === selectedDocument.subjectId && row.counterparty === selectedDocument.counterparty && row.currency === selectedDocument.currency);
  async function submit(body: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operations/finance-open-items', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '往来操作失败。');
      setNotice(result.reused ? '核销已幂等复用。' : '往来记录已保存。');
      if (body.action === 'register') { setVoucherId(''); setSubjectId(''); setCounterparty(''); setEvidence(''); }
      else { setAmount(''); setSettlementEvidence(''); }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '往来操作失败。'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 border-b border-border py-4" aria-label="应收应付与核销">
    <h2 className="text-sm font-semibold">应收应付与核销</h2>
    <p className="text-xs text-muted">仅从已过账凭证登记辅助往来项，不重复生成凭证。核销记录关联开放期间，不修改原凭证。</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {canCreate && <form className="grid gap-2 border-b border-border pb-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); void submit({ action: 'register', bookId, voucherId, subjectId, counterparty, kind, dueDate, evidence }); }}>
      <strong className="text-xs sm:col-span-2 xl:col-span-4">登记过账凭证往来</strong>
      <label className="grid gap-1 text-xs">凭证<select className={cls} required value={voucherId} onChange={event => { setVoucherId(event.target.value); setSubjectId(''); }}><option value="">选择已过账凭证</option>{postedVouchers.map(row => <option key={row.id} value={row.id}>{row.date.slice(0, 10)} · {row.sourceKey}</option>)}</select></label>
      <label className="grid gap-1 text-xs">往来科目<select className={cls} required value={subjectId} onChange={event => setSubjectId(event.target.value)}><option value="">选择末级科目</option>{eligibleSubjects.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
      <label className="grid gap-1 text-xs">往来类型<select className={cls} value={kind} onChange={event => setKind(event.target.value)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="grid gap-1 text-xs">往来对象<input className={cls} required maxLength={160} value={counterparty} onChange={event => setCounterparty(event.target.value)} /></label>
      <label className="grid gap-1 text-xs">到期日<input className={cls} required type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} /></label>
      <label className="grid gap-1 text-xs sm:col-span-2">往来依据<input className={cls} required maxLength={1000} value={evidence} onChange={event => setEvidence(event.target.value)} /></label>
      <Button size="sm" disabled={busy || !voucherId || !subjectId || !counterparty.trim() || !evidence.trim()}>从凭证登记</Button>
    </form>}
    {canApprove && periodId && periodOpen && <form className="grid gap-2 border-b border-border py-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); void submit({ action: 'settle', bookId, documentId, paymentId, documentRevision: selectedDocument?.revision, paymentRevision: selectedPayment?.revision, periodId, date, amount, idempotencyKey: crypto.randomUUID(), evidence: settlementEvidence }); }}>
      <strong className="text-xs sm:col-span-2 xl:col-span-4">核销</strong>
      <label className="grid gap-1 text-xs">应付 / 应收单据<select className={cls} required value={documentId} onChange={event => { setDocumentId(event.target.value); setPaymentId(''); }}><option value="">选择单据</option>{documents.filter(row => row.bookId === bookId).map(row => <option key={row.id} value={row.id}>{labels[row.kind]} · {row.counterparty} · 未核 {row.remaining} {row.currency}</option>)}</select></label>
      <label className="grid gap-1 text-xs">付款 / 收款<select className={cls} required value={paymentId} onChange={event => setPaymentId(event.target.value)}><option value="">选择匹配资金项</option>{payments.map(row => <option key={row.id} value={row.id}>{labels[row.kind]} · {row.voucher.sourceKey} · 未核 {row.remaining} {row.currency}</option>)}</select></label>
      <label className="grid gap-1 text-xs">核销日期<input className={cls} required type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <label className="grid gap-1 text-xs">核销金额<input className={cls} required inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
      <label className="grid gap-1 text-xs sm:col-span-2">核销依据<input className={cls} required maxLength={1000} value={settlementEvidence} onChange={event => setSettlementEvidence(event.target.value)} /></label>
      <Button size="sm" disabled={busy || !documentId || !paymentId || !amount || !settlementEvidence.trim()}>保存核销</Button>
    </form>}
    <div className="overflow-x-auto"><table aria-label="往来项余额" className="w-full min-w-[900px] text-left text-xs"><thead><tr>{['类型', '往来对象', '科目', '凭证来源', '到期日', '原金额', '已核销', '未核销'].map(value => <th key={value} className="border-b border-border p-2">{value}</th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.id} className="border-b border-border"><td className="p-2">{labels[row.kind] ?? row.kind}</td><td className="p-2">{row.counterparty}</td><td className="p-2">{subjects.find(subject=>subject.id===row.subjectId)?.code}</td><td className="p-2">{row.voucher.sourceKey}</td><td className="p-2">{row.dueDate.slice(0,10)}</td><td className="p-2">{row.amount} {row.currency}</td><td className="p-2">{row.allocated}</td><td className="p-2">{row.remaining}</td></tr>)}</tbody></table>{!data.items.length && <p className="py-4 text-center text-xs text-muted">当前账套没有往来项。</p>}</div>
    <div className="overflow-x-auto"><table aria-label="核销记录" className="w-full min-w-[700px] text-left text-xs"><thead><tr>{['核销日期', '单据 / 资金项', '金额', '依据', '状态', '操作'].map(value => <th key={value} className="border-b border-border p-2">{value}</th>)}</tr></thead><tbody>{data.settlements.map(row => <tr key={row.id} className="border-b border-border"><td className="p-2">{row.date.slice(0,10)}</td><td className="p-2">{data.items.find(item => item.id === row.documentId)?.counterparty ?? row.documentId} / {data.items.find(item => item.id === row.paymentId)?.voucher.sourceKey ?? row.paymentId}</td><td className="p-2">{row.amount}</td><td className="p-2">{row.evidence}</td><td className="p-2">{row.reversedAt ? '已冲销' : '有效'}</td><td className="p-2">{canApprove && !row.reversedAt && <Button size="sm" variant="secondary" disabled={busy} onClick={() => { const reason = window.prompt('核销冲销依据'); if (reason?.trim()) void submit({ action: 'reverse-settlement', bookId, settlementId: row.id, evidence: reason.trim() }); }}>冲销</Button>}</td></tr>)}</tbody></table>{!data.settlements.length && <p className="py-4 text-center text-xs text-muted">当前账套没有核销记录。</p>}</div>
    {(data.truncated?.items || data.truncated?.settlements) && <p className="text-xs text-muted">仅显示部分往来与核销记录，不代表全账套汇总。</p>}
  </section>;
}
