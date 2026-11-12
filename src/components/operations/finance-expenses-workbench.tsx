'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppShellUser } from '@/components/app-shell/app-shell-context';
import { Button } from '@/components/ui/button';
import { roleCanPerformAction } from '@/lib/accounts/permissions';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';

type Book = { id: string; code: string; name: string; currency: string; enabled: boolean };
type Period = { id: string; bookId: string; code: string; start: string; end: string; status: string };
type Subject = { id: string; bookId: string; code: string; name: string; normalSide: string; enabled: boolean; leaf: boolean };
type Expense = { id: string; number: string; category: string; payee: string; description: string; expenseDate: string; amount: string; currency: string; bookId: string; periodId: string; debitSubjectId: string; creditSubjectId: string; status: string; revision: number; createdBy: string; decisionMemo: string; voucher: { id: string; status: string; sourceKey: string } | null };
type Data = { books: Book[]; periods: Period[]; subjects: Subject[]; expenses: Expense[] };
const blank: Data = { books: [], periods: [], subjects: [], expenses: [] };
const input = 'h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
const today = new Date().toISOString().slice(0, 10);
function getHeaders() {
  const headers = new Headers({ 'content-type': 'application/json' });
  try { const scope = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; headers.set('x-workspace-id', scope.workspaceId || 'default'); }
  catch { headers.set('x-workspace-id', 'default'); }
  return headers;
}

export function FinanceExpensesWorkbench() {
  const user = useAppShellUser();
  const canCreate = roleCanPerformAction(user?.userRole, 'operations', 'create', user?.rolePermissions);
  const canApprove = roleCanPerformAction(user?.userRole, 'operations', 'approve', user?.rolePermissions);
  const [data, setData] = useState<Data>(blank), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [form, setForm] = useState({ number: '', category: '', payee: '', description: '', expenseDate: today, amount: '', bookId: '', periodId: '', debitSubjectId: '', creditSubjectId: '' });
  const load = useCallback(async () => {
    const response = await fetch('/api/operations/finance-expenses', { headers: getHeaders(), cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? '费用读取失败。');
    setData(result);
    setForm(current => ({ ...current, bookId: current.bookId || result.books[0]?.id || '', periodId: current.periodId || result.periods.find((row: Period) => row.status === 'OPEN')?.id || '' }));
  }, []);
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : '费用读取失败。')); }, [load]);
  useEffect(() => {
    const reset = () => { setData(blank); setForm(current => ({ ...current, bookId: '', periodId: '', debitSubjectId: '', creditSubjectId: '' })); void load().catch(cause => setError(cause instanceof Error ? cause.message : '费用读取失败。')); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, [load]);
  const book = data.books.find(row => row.id === form.bookId);
  const period = data.periods.find(row => row.id === form.periodId && row.bookId === form.bookId);
  const subjects = useMemo(() => data.subjects.filter(row => row.bookId === form.bookId && row.enabled && row.leaf), [data.subjects, form.bookId]);
  async function command(payload: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operations/finance-expenses', { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '费用操作失败。');
      setNotice(payload.action === 'approve' ? '费用已复核，已生成总账凭证草稿；尚未过账或付款。' : payload.action === 'submit' ? '费用已提交独立复核。' : payload.action === 'reject' ? '费用已驳回。' : payload.action === 'edit' ? '费用草稿已更新。' : '费用草稿已保存。');
      if (payload.action === 'create' || payload.action === 'edit') {
        setEditingExpense(null);
        setForm(current => ({ ...current, number: '', category: '', payee: '', description: '', amount: '' }));
      }
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '费用操作失败。'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5" data-testid="finance-expenses-workbench">
    <p className="text-xs text-muted">批准费用只会创建待审核的总账凭证草稿，不代表资金已支付或凭证已过账。币种必须与账套本位币一致，跨币种费用请先取得并登记汇率依据。</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
    {canCreate && <form className="space-y-3 border-b border-border pb-5" onSubmit={event => { event.preventDefault(); void command({ action: editingExpense ? 'edit' : 'create', ...(editingExpense ? { expenseId: editingExpense.id, revision: editingExpense.revision } : {}), ...form, currency: book?.currency ?? '' }); }}>
      <h2 className="text-sm font-semibold">{editingExpense ? `编辑费用草稿 · ${editingExpense.number}` : '新建费用单'}</h2>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1 text-xs text-muted">费用单号<input className={input} required maxLength={80} value={form.number} onChange={event => setForm({ ...form, number: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-muted">费用类别<input className={input} required maxLength={80} value={form.category} onChange={event => setForm({ ...form, category: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-muted">收款对象<input className={input} required maxLength={160} value={form.payee} onChange={event => setForm({ ...form, payee: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-muted">费用日期<input className={input} required type="date" value={form.expenseDate} onChange={event => setForm({ ...form, expenseDate: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-muted">账套<select className={input} required value={form.bookId} onChange={event => setForm({ ...form, bookId: event.target.value, periodId: '', debitSubjectId: '', creditSubjectId: '' })}><option value="">选择账套</option>{data.books.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name} ({row.currency})</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted">开放期间<select className={input} required value={form.periodId} onChange={event => setForm({ ...form, periodId: event.target.value })}><option value="">选择期间</option>{data.periods.filter(row => row.bookId === form.bookId && row.status === 'OPEN').map(row => <option key={row.id} value={row.id}>{row.code} · {row.start.slice(0, 10)} 至 {row.end.slice(0, 10)}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted">借方费用科目<select className={input} required value={form.debitSubjectId} onChange={event => setForm({ ...form, debitSubjectId: event.target.value })}><option value="">选择借方科目</option>{subjects.filter(row => row.normalSide === 'DEBIT').map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted">贷方应付/资金科目<select className={input} required value={form.creditSubjectId} onChange={event => setForm({ ...form, creditSubjectId: event.target.value })}><option value="">选择贷方科目</option>{subjects.filter(row => row.normalSide === 'CREDIT').map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-muted">金额（{book?.currency ?? '账套币种'}）<input className={input} required inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-muted sm:col-span-2 xl:col-span-3">费用说明<input className={input} required maxLength={500} value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>
      </div>
      <div className="flex gap-2"><Button disabled={busy || !period || period.status !== 'OPEN'}>{editingExpense ? '更新费用草稿' : '保存费用草稿'}</Button>{editingExpense && <Button type="button" variant="secondary" disabled={busy} onClick={() => { setEditingExpense(null); setForm(current => ({ ...current, number: '', category: '', payee: '', description: '', amount: '' })); }}>取消编辑</Button>}</div>
    </form>}
    <section className="space-y-2"><h2 className="text-sm font-semibold">费用记录 · 最近 {data.expenses.length} 条</h2><div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead><tr>{['费用单', '日期 / 类别', '收款对象 / 说明', '金额', '状态', '总账凭证', '操作'].map(label => <th key={label} className="border-b border-border p-2">{label}</th>)}</tr></thead><tbody>{data.expenses.map(expense => <tr key={expense.id} className="border-b border-border"><td className="p-2">{expense.number}</td><td className="p-2">{expense.expenseDate.slice(0, 10)}<span className="block text-muted">{expense.category}</span></td><td className="p-2">{expense.payee}<span className="block text-muted">{expense.description}</span></td><td className="p-2">{expense.amount} {expense.currency}</td><td className="p-2">{{ DRAFT: '草稿', SUBMITTED: '待复核', APPROVED: '已批准', REJECTED: '已驳回' }[expense.status] ?? expense.status}{expense.decisionMemo && <span className="block text-muted">{expense.decisionMemo}</span>}</td><td className="p-2">{expense.voucher ? <a className="text-brand-dark underline" href="/operations/finance-ledger">凭证 {expense.voucher.status === 'DRAFT' ? '草稿' : expense.voucher.status}</a> : '—'}</td><td className="p-2"><div className="flex gap-1">{expense.status === 'DRAFT' && expense.createdBy === user?.userId && canCreate && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => { setEditingExpense(expense); setForm({ number: expense.number, category: expense.category, payee: expense.payee, description: expense.description, expenseDate: expense.expenseDate.slice(0, 10), amount: expense.amount.replace(/0+$/, '').replace(/\.$/, ''), bookId: expense.bookId, periodId: expense.periodId, debitSubjectId: expense.debitSubjectId, creditSubjectId: expense.creditSubjectId }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>修改</Button><Button size="sm" disabled={busy} onClick={() => void command({ action: 'submit', expenseId: expense.id, revision: expense.revision })}>提交复核</Button></>}{expense.status === 'SUBMITTED' && expense.createdBy !== user?.userId && canApprove && <><Button size="sm" variant="secondary" disabled={busy} onClick={() => void command({ action: 'approve', expenseId: expense.id, revision: expense.revision })}>批准并生成凭证</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { const decisionMemo = window.prompt('驳回原因'); if (decisionMemo) void command({ action: 'reject', expenseId: expense.id, revision: expense.revision, decisionMemo }); }}>驳回</Button></>}</div></td></tr>)}</tbody></table>{!data.expenses.length && <p className="py-6 text-center text-sm text-muted">当前工作区暂无费用记录。</p>}</div></section>
  </div>;
}
