"use client";
import {FinanceVoucherTemplates} from './finance-voucher-templates';
import {FinanceStructurePanel} from './finance-structure-panel';
import { FinanceFxRevaluations } from './finance-fx-revaluations';
import { FinanceExternalSources } from './finance-external-sources';
import { FinanceTargetCatalog } from './finance-target-catalog';
import { FinanceBankPanel } from './finance-bank-panel';
import { FinanceVoucherImport } from './finance-voucher-import';
import { FinanceAttachments } from './finance-attachments';
import { FinanceAuxiliaryPanel } from './finance-auxiliary-panel';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FinanceReportPanel } from './finance-report-panel';
import { FinanceCloseReview } from './finance-close-review';
import { FinanceSourceImport } from './finance-source-import';
import { FinanceOpenItems } from './finance-open-items';
import { sumLedgerAmounts } from '@/lib/finance/amount-view';
import { useAppShellUser } from '@/components/app-shell/app-shell-context';
import { roleCanPerformAction } from '@/lib/accounts/permissions';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';

type Book = { id: string; code: string; name: string; currency: string; enabled: boolean; revision: number; closePolicy: unknown };
type Period = { id: string; bookId: string; code: string; start: string; end: string; status: string; revision: number };
type Subject = { id: string; bookId: string; code: string; name: string; normalSide: string; enabled: boolean; leaf: boolean };
type Voucher = { id: string; bookId: string; periodId: string; sourceKey: string; date: string; memo: string; status: string; kind: string; reversalOf: string | null; createdBy: string; revision: number; lines: Array<{ subjectId: string; lineNumber: number; debit: string; credit: string; memo: string }> };
type Ledger = { books: Book[]; periods: Period[]; subjects: Subject[]; vouchers: Voucher[]; trial: { rows: Array<{ accountId: string; openingSigned: string; debit: string; credit: string; closingSigned: string }>; openingDifference: string; movementDifference: string; closingDifference: string; balanced: boolean } | null };
const inputClass = 'h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
const today = new Date().toISOString().slice(0, 10);
export function FinanceLedgerWorkbench() {
  const user = useAppShellUser();
  const canCreate = roleCanPerformAction(user?.userRole, 'operations', 'create', user?.rolePermissions);
  const canApprove = roleCanPerformAction(user?.userRole, 'operations', 'approve', user?.rolePermissions);
  const [data, setData] = useState<Ledger>({ books: [], periods: [], subjects: [], vouchers: [], trial: null });
  const [bookId, setBookId] = useState(''), [periodId, setPeriodId] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [bookForm, setBookForm] = useState({ code: '', name: '', currency: 'CNY' });
  const [periodForm, setPeriodForm] = useState({ code: '', start: today.slice(0, 7) + '-01', end: today });
  const [subjectForm, setSubjectForm] = useState({ parentId: '', code: '', name: '', normalSide: 'DEBIT' });
  const [openingForm, setOpeningForm] = useState({ subjectId: '', amount: '', side: 'DEBIT' });
  const [voucherForm, setVoucherForm] = useState({ sourceKey: '', date: today, memo: '', debitSubjectId: '', creditSubjectId: '', amount: '' });
  const book = data.books.find(row => row.id === bookId);
  const period = data.periods.find(row => row.id === periodId);
  const subjects = data.subjects.filter(row => row.bookId === bookId);
  const vouchers = data.vouchers.filter(row => row.bookId === bookId);
  const headers = useCallback(() => { const h = new Headers({ 'content-type': 'application/json' }); try { const value = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; h.set('x-workspace-id', value.workspaceId || 'default'); } catch { h.set('x-workspace-id', 'default'); } return h; }, []);
  const load = useCallback(async (nextBook = '', nextPeriod = '') => {
    const query = new URLSearchParams(); if (nextBook) query.set('bookId', nextBook); if (nextPeriod) query.set('periodId', nextPeriod);
    const response = await fetch(`/api/operations/finance-ledger?${query}`, { headers: headers(), cache: 'no-store' });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? '总账读取失败。');
    setData(result); setBookId(current => nextBook || current || result.books[0]?.id || '');
    setPeriodId(current => nextPeriod || current || result.periods.find((row: Period) => row.bookId === (nextBook || current))?.id || '');
  }, [headers]);
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : '总账读取失败。')); }, [load]);
  useEffect(() => {
    const reset = () => {
      setData({ books: [], periods: [], subjects: [], vouchers: [], trial: null });
      setBookId('');
      setPeriodId('');
      void load('', '').catch(cause => setError(cause instanceof Error ? cause.message : '总账读取失败。'));
    };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, [load]);
  async function command(action: string, values: Record<string, unknown> = {}) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operations/finance-ledger', { method: 'POST', headers: headers(), body: JSON.stringify({ action, ...values }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error ?? '总账操作失败。');
      if (action === 'create-book') { setBookId(result.book.id); setPeriodId(''); }
      if (action === 'create-period') setPeriodId(result.period.id);
      setNotice(result.reused ? '请求已幂等复用。' : '操作已保存并记录审计。');
      await load(action === 'create-book' ? result.book.id : bookId, action === 'create-period' ? result.period.id : periodId);
      return result;
    } catch (cause) { setError(cause instanceof Error ? cause.message : '总账操作失败。'); return null; }
    finally { setBusy(false); }
  }
  return <div className="space-y-4" data-testid="finance-ledger-workbench">
    <p className="text-xs text-muted">ERP 总账凭证是独立事实源，Amazon 财务交易和 FBA 费用草稿不会自动过账。结账检查仅覆盖当前账套期间内已登记的期初与凭证，不代表采购、库存、报销等外部单据全部对账。</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    <section className="space-y-3 border-b border-border pb-4"><h2 className="text-sm font-semibold">账套</h2><div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-xs text-muted">当前账套<select aria-label="当前账套" className={inputClass} value={bookId} onChange={event => { setBookId(event.target.value); setPeriodId(''); void load(event.target.value, '').catch(cause => setError(cause.message)); }}><option value="">选择账套</option>{data.books.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name} ({row.currency})</option>)}</select></label>{canCreate && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void command('create-book', bookForm); }}><input className={inputClass} aria-label="账套编码" placeholder="编码" required value={bookForm.code} onChange={event => setBookForm({ ...bookForm, code: event.target.value })} /><input className={inputClass} aria-label="账套名称" placeholder="账套名称" required value={bookForm.name} onChange={event => setBookForm({ ...bookForm, name: event.target.value })} /><select aria-label="本位币" className={inputClass} value={bookForm.currency} onChange={event => setBookForm({ ...bookForm, currency: event.target.value })}><option>CNY</option><option>USD</option><option>EUR</option><option>GBP</option><option>JPY</option></select><Button size="sm" disabled={busy}>新建账套</Button></form>}</div></section>
    {book && <>
      <section className="space-y-3 border-b border-border pb-4"><div className="flex flex-wrap items-center gap-2"><h2 className="mr-2 text-sm font-semibold">会计期间</h2><label className="grid gap-1 text-xs text-muted">当前期间<select aria-label="当前期间" className={inputClass} value={periodId} onChange={event => { setPeriodId(event.target.value); void load(bookId, event.target.value).catch(cause => setError(cause.message)); }}><option value="">选择期间</option>{data.periods.filter(row => row.bookId === bookId).map(row => <option key={row.id} value={row.id}>{row.code} · {row.start.slice(0, 10)} — {row.end.slice(0, 10)} · {row.status}</option>)}</select></label><span className="text-xs text-muted">{period ? `revision ${period.revision}` : ''}</span></div>
        {canCreate && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void command('create-period', { bookId, ...periodForm }); }}><input className={inputClass} aria-label="期间编码" placeholder="期间编码" required value={periodForm.code} onChange={event => setPeriodForm({ ...periodForm, code: event.target.value })} /><input className={inputClass} aria-label="期间开始" type="date" required value={periodForm.start} onChange={event => setPeriodForm({ ...periodForm, start: event.target.value })} /><input className={inputClass} aria-label="期间结束" type="date" required value={periodForm.end} onChange={event => setPeriodForm({ ...periodForm, end: event.target.value })} /><Button size="sm" disabled={busy}>新增期间</Button>{period?.status === 'NOT_OPEN' && canApprove && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void command('open-period', { periodId, revision: period.revision })}>开启期间</Button>}</form>}
      </section>
      <section className="space-y-3 border-b border-border pb-4"><h2 className="text-sm font-semibold">会计科目</h2><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{subjects.map(subject => <div key={subject.id} className="border-b border-border py-2 text-sm"><span className="font-medium">{subject.code} · {subject.name}</span><span className="ml-2 text-xs text-muted">{subject.normalSide === 'DEBIT' ? '借' : '贷'} · {subject.leaf ? '末级' : '上级'}</span></div>)}</div>{canCreate && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void command('create-subject', { bookId, ...subjectForm, parentId: subjectForm.parentId || null }); }}><select aria-label="上级科目" className={inputClass} value={subjectForm.parentId} onChange={event => setSubjectForm({ ...subjectForm, parentId: event.target.value })}><option value="">一级科目</option>{subjects.filter(row => row.leaf).map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select><input className={inputClass} aria-label="科目编码" placeholder="科目编码" required value={subjectForm.code} onChange={event => setSubjectForm({ ...subjectForm, code: event.target.value })} /><input className={inputClass} aria-label="科目名称" placeholder="科目名称" required value={subjectForm.name} onChange={event => setSubjectForm({ ...subjectForm, name: event.target.value })} /><select aria-label="余额方向" className={inputClass} value={subjectForm.normalSide} onChange={event => setSubjectForm({ ...subjectForm, normalSide: event.target.value })}><option value="DEBIT">借方</option><option value="CREDIT">贷方</option></select><Button size="sm" disabled={busy}>新增科目</Button></form>}</section>
      {period && <>
        <section className="space-y-3 border-b border-border pb-4"><h2 className="text-sm font-semibold">期初余额 · {book.currency}</h2>{canCreate && period.status !== 'CLOSED' && <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); void command('save-opening', { periodId, revision: period.revision, ...openingForm }); }}><select aria-label="期初科目" className={inputClass} required value={openingForm.subjectId} onChange={event => setOpeningForm({ ...openingForm, subjectId: event.target.value })}><option value="">选择末级科目</option>{subjects.filter(row => row.enabled && row.leaf).map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select><input className={inputClass} aria-label="期初金额" placeholder="金额" required inputMode="decimal" value={openingForm.amount} onChange={event => setOpeningForm({ ...openingForm, amount: event.target.value })} /><select aria-label="期初借贷方向" className={inputClass} value={openingForm.side} onChange={event => setOpeningForm({ ...openingForm, side: event.target.value })}><option value="DEBIT">借方</option><option value="CREDIT">贷方</option></select><Button size="sm" disabled={busy}>保存期初</Button></form>}</section>
        {canCreate && period.status === 'OPEN' && <FinanceSourceImport key={`${bookId}:${periodId}`} periodId={periodId} subjects={subjects} headers={headers} onSaved={() => load(bookId, periodId)} />}
        <section className="space-y-3 border-b border-border pb-4"><h2 className="text-sm font-semibold">凭证 · {book.currency}</h2>{canCreate && period.status === 'OPEN' && <form className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); void command('create-voucher', { periodId, idempotencyKey: crypto.randomUUID(), sourceKey: voucherForm.sourceKey, date: voucherForm.date, memo: voucherForm.memo, lines: [{ subjectId: voucherForm.debitSubjectId, debit: voucherForm.amount, credit: '0' }, { subjectId: voucherForm.creditSubjectId, debit: '0', credit: voucherForm.amount }] }); }}><input className={inputClass} aria-label="凭证来源标识" placeholder="来源单号/业务键" required value={voucherForm.sourceKey} onChange={event => setVoucherForm({ ...voucherForm, sourceKey: event.target.value })} /><input className={inputClass} aria-label="凭证日期" type="date" required value={voucherForm.date} onChange={event => setVoucherForm({ ...voucherForm, date: event.target.value })} /><select className={inputClass} aria-label="借方科目" required value={voucherForm.debitSubjectId} onChange={event => setVoucherForm({ ...voucherForm, debitSubjectId: event.target.value })}><option value="">借方科目</option>{subjects.filter(row => row.enabled && row.leaf).map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select><select className={inputClass} aria-label="贷方科目" required value={voucherForm.creditSubjectId} onChange={event => setVoucherForm({ ...voucherForm, creditSubjectId: event.target.value })}><option value="">贷方科目</option>{subjects.filter(row => row.enabled && row.leaf).map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select><input className={inputClass} aria-label="凭证金额" placeholder="金额" required inputMode="decimal" value={voucherForm.amount} onChange={event => setVoucherForm({ ...voucherForm, amount: event.target.value })} /><input className={inputClass} aria-label="凭证摘要" placeholder="摘要" value={voucherForm.memo} onChange={event => setVoucherForm({ ...voucherForm, memo: event.target.value })} /><Button size="sm" disabled={busy}>保存凭证草稿</Button></form>}
          <div className="overflow-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr>{['日期', '来源', '类型', '状态', '借方', '贷方', '操作'].map(text => <th key={text} className="border-b border-border p-2">{text}</th>)}</tr></thead><tbody>{vouchers.filter(row => row.periodId === periodId).map(voucher => <tr key={voucher.id}><td className="p-2">{voucher.date.slice(0, 10)}</td><td className="p-2">{voucher.sourceKey}</td><td className="p-2">{voucher.kind === 'REVERSAL' ? '红字冲销' : '普通'}</td><td className="p-2">{{ DRAFT: '草稿', REVIEWED: '已审核', POSTED: '已过账' }[voucher.status] ?? voucher.status}</td><td className="p-2">{sumLedgerAmounts(voucher.lines.map(line => line.debit))}</td><td className="p-2">{sumLedgerAmounts(voucher.lines.map(line => line.credit))}</td><td className="p-2"><div className="flex gap-1">{voucher.status === 'DRAFT' && voucher.createdBy !== user?.userId && canApprove && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void command('review-voucher', { voucherId: voucher.id, revision: voucher.revision })}>独立审核</Button>}{voucher.status === 'REVIEWED' && canApprove && <Button size="sm" disabled={busy} onClick={() => void command('post-voucher', { voucherId: voucher.id, revision: voucher.revision })}>过账</Button>}{voucher.status === 'POSTED' && voucher.kind === 'STANDARD' && canCreate && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { const idempotencyKey = crypto.randomUUID(); void command('reverse-voucher', { voucherId: voucher.id, periodId, idempotencyKey, sourceKey: `REVERSAL:${voucher.sourceKey}:${idempotencyKey}`, date: today }); }}>生成红字草稿</Button>}</div></td></tr>)}</tbody></table>{!vouchers.some(row => row.periodId === periodId) && <p className="py-4 text-center text-sm text-muted">当前期间无已登记凭证。</p>}</div>
        </section>
        <FinanceTargetCatalog bookId={bookId} canApprove={canApprove} headers={headers} onSaved={()=>load(bookId,periodId)}/>
        <FinanceBankPanel bookId={bookId} periodId={periodId} canCreate={canCreate} canApprove={canApprove} headers={headers}/>
      <FinanceExternalSources key={`${bookId}:${periodId}`} bookId={bookId} periodId={periodId} subjects={data.subjects} canCreate={canCreate} headers={headers} onSaved={()=>load(bookId,periodId)}/>
        <FinanceVoucherTemplates key={`voucher-template:${bookId}:${periodId}`} bookId={bookId} periodId={periodId} headers={headers} canCreate={canCreate} canApprove={canApprove}/><FinanceStructurePanel key={`structure:${bookId}:${periodId}`} bookId={bookId} periodId={periodId} headers={headers}/><FinanceFxRevaluations key={`fx:${bookId}:${periodId}`} bookId={bookId} periodId={periodId} canCreate={canCreate} canApprove={canApprove} headers={headers}/>
        <FinanceVoucherImport key={`import:${bookId}:${periodId}`} bookId={bookId} periodId={periodId} canCreate={canCreate && period.status === 'OPEN'} headers={headers} onSaved={()=>load(bookId,periodId)}/>
        <FinanceAttachments key={`files:${bookId}:${periodId}`} vouchers={vouchers.filter(row=>row.periodId===periodId)} canCreate={canCreate && period.status === 'OPEN'} headers={headers} onSaved={()=>load(bookId,periodId)}/>
        <FinanceAuxiliaryPanel key={`aux:${bookId}:${periodId}:${vouchers.map(row=>row.revision).join(',')}`} bookId={bookId} vouchers={vouchers.filter(row=>row.periodId===periodId)} subjects={subjects} canCreate={canCreate} canApprove={canApprove} headers={headers} onSaved={()=>load(bookId,periodId)}/>
        <FinanceOpenItems key={`${bookId}:${vouchers.map(row => row.revision).join(',')}`} bookId={bookId} periodId={periodId} periodOpen={period.status === 'OPEN'} vouchers={vouchers} subjects={subjects} canCreate={canCreate} canApprove={canApprove} headers={headers} />
        <FinanceReportPanel key={`${bookId}:${periodId}:${vouchers.map(row=>row.revision).join(',')}`} bookId={bookId} periodId={periodId} userId={user?.userId??''} canCreate={canCreate} canApprove={canApprove} headers={headers} onSaved={()=>load(bookId,periodId)}/>
        <FinanceCloseReview book={book} period={period} userId={user?.userId??''} canCreate={canCreate} canApprove={canApprove} headers={headers} onSaved={()=>load(bookId,periodId)}/>
        {data.trial && <section className="space-y-2"><h2 className="text-sm font-semibold">试算平衡 · {book.currency}</h2><p className="text-xs text-muted">期初差额 {data.trial.openingDifference} · 本期借贷差额 {data.trial.movementDifference} · 期末差额 {data.trial.closingDifference} · {data.trial.balanced ? '平衡' : '不平衡'}</p><div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{['科目', '期初有符号余额', '借方发生', '贷方发生', '期末有符号余额'].map(text => <th key={text} className="border-b border-border p-2">{text}</th>)}</tr></thead><tbody>{data.trial.rows.map(row => { const subject = subjects.find(value => value.id === row.accountId); return <tr key={row.accountId}><td className="p-2">{subject?.code} · {subject?.name}</td><td className="p-2">{row.openingSigned}</td><td className="p-2">{row.debit}</td><td className="p-2">{row.credit}</td><td className="p-2">{row.closingSigned}</td></tr>; })}</tbody></table></div></section>}
        {canApprove && book.closePolicy == null && period.status === 'OPEN' && <Button size="sm" variant="secondary" disabled={busy || !data.trial?.balanced || vouchers.some(row => row.periodId === periodId && row.status !== 'POSTED')} onClick={() => void command('close-period', { periodId, revision: period.revision })}>关闭本账簿期间</Button>}{canApprove && period.status === 'CLOSED' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void command('reopen-period', { periodId, revision: period.revision })}>重新开启期间</Button>}
      </>}
    </>}
  </div>;
}
