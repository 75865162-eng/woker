'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { StandardDataTable } from '@/components/ui/table-variants';
import { type DataTableColumn } from '@/components/ui/data-table';
import { useAppShellUser } from '@/components/app-shell/app-shell-context';
import { roleCanPerformAction } from '@/lib/accounts/permissions';
import { workspaceScopeChangedEventName } from '@/lib/workspace/workspace-scope-events';
import { ListPageTemplate } from '@/components/templates/page-templates';

type Allocation = {
  id: string; settlementReportId: string; settlementId: string; currency: string;
  basisType: string; algorithmVersion: string; remainderPolicy: string; inputDigest: string;
  status: string; openItemId: string | null; settlementRef: string | null;
  createdBy: string; createdAt: string; evidence: string;
  reconciliation: { ok?: boolean; distinctOrderCount?: number; total?: { originalTotal?: string; principalTotal?: string; feePoolsTotal?: string } } | null;
};
type Line = {
  id: string; sku: string; sellerSku: string | null; businessDate: string | null; currency: string;
  basisAmount: string; rate: string; shareStorageFee: string; shareLongStorageFee: string;
  shareAdvSpendFee: string; shareCouponRedemptionFee: string; shareReserveFee: string;
  shareReimbursementFee: string; shareDisposalFee: string; shareShopOtherFee: string;
  isRemainderBearer: boolean; overlapKey: string; principalRowRefs: unknown; suppressedRowNumbers: unknown;
};
type Result = { allocations: Allocation[]; lines: Line[]; truncated: { allocations: boolean; lines: boolean }; limits: { allocations: number; lines: number } };
const cls = 'h-9 min-w-0 rounded border border-border bg-background px-2 text-sm';
const statusNames: Record<string, string> = { STAGED: '已暂存（未交接）', PUBLISHED: '已交接', REVERSED: '已冲销' };
const basisNames: Record<string, string> = { PRINCIPAL: '本金占比', SALES: '销量占比', NONE: '无可分摊基数' };
const feeColumns: Array<[keyof Line, string]> = [
  ['shareStorageFee', '仓储费'], ['shareLongStorageFee', '长期仓储费'], ['shareAdvSpendFee', '广告费'],
  ['shareCouponRedemptionFee', '优惠券费'], ['shareReserveFee', '预留金'], ['shareReimbursementFee', '赔偿'],
  ['shareDisposalFee', '弃置费'], ['shareShopOtherFee', '店铺其他费'],
];

const allocationColumns: DataTableColumn<Allocation>[] = [
  {
    key: 'settlementId',
    header: '结算号',
    width: 170,
    render: (row) => (<><span>{row.settlementId}</span><span className="block text-muted">{row.id.slice(0, 8)}</span></>),
  },
  { key: 'currency', header: '币种', width: 64, render: (row) => row.currency },
  { key: 'basis', header: '基数', width: 120, render: (row) => basisNames[row.basisType] ?? row.basisType },
  {
    key: 'algorithm',
    header: '算法 / 尾差',
    width: 150,
    render: (row) => (
      <>
        <span>{row.algorithmVersion}</span>
        <span className="block text-muted">{row.remainderPolicy === 'MAX_PRINCIPAL_SKU' ? '本金最大 SKU' : '最大余数法'}</span>
      </>
    ),
  },
  {
    key: 'reconciliation',
    header: '对账',
    width: 170,
    render: (row) => (
      <>
        {row.reconciliation?.ok ? <span className="text-success-ink">三类对账通过</span> : <span className="text-danger-ink">未通过</span>}
        <span className="block text-muted">去重后订单 {row.reconciliation?.distinctOrderCount ?? '—'}</span>
      </>
    ),
  },
  { key: 'status', header: '状态', width: 110, render: (row) => statusNames[row.status] ?? row.status },
  { key: 'ref', header: '交接引用', width: 130, render: (row) => row.openItemId || row.settlementRef || '—' },
  { key: 'createdAt', header: '生成时间', width: 100, render: (row) => row.createdAt.slice(0, 10) },
];

const lineColumns: DataTableColumn<Line>[] = [
  {
    key: 'sku',
    header: 'SKU',
    width: 140,
    render: (line) => (
      <>
        <span>{line.sku}</span>
        {line.isRemainderBearer && <span className="ml-1 text-warning-ink">尾差</span>}
      </>
    ),
  },
  { key: 'basisAmount', header: '基数金额', width: 110, numeric: true, render: (line) => line.basisAmount },
  { key: 'rate', header: 'rate', width: 90, numeric: true, render: (line) => Number(line.rate).toFixed(6) },
  ...feeColumns.map(([key, label]) => ({
    key: key as string,
    header: label,
    width: 82,
    numeric: true,
    render: (line: Line) => String(line[key]),
  })),
  {
    key: 'suppressed',
    header: '去重',
    width: 110,
    render: (line) => (Array.isArray(line.suppressedRowNumbers) ? `抑制 ${(line.suppressedRowNumbers as unknown[]).length} 行` : '—'),
  },
];

export function SettlementAllocationWorkbench() {
  const user = useAppShellUser();
  const canCreate = roleCanPerformAction(user?.userRole, 'operations', 'create', user?.rolePermissions);
  const canApprove = roleCanPerformAction(user?.userRole, 'operations', 'approve', user?.rolePermissions);
  const [data, setData] = useState<Result>({ allocations: [], lines: [], truncated: { allocations: false, lines: false }, limits: { allocations: 100, lines: 5000 } });
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState({ settlementReportId: '', settlementId: '', currency: 'USD', marketplaceId: 'ATVPDKIKX0DER', remainderPolicy: 'LARGEST_REMAINDER', controlTotal: '', evidence: '' });
  const [publish, setPublish] = useState({ openItemId: '', settlementRef: '', evidence: '' });
  const [reverseEvidence, setReverseEvidence] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const headers = useCallback(() => {
    const h = new Headers({ 'content-type': 'application/json' });
    try { const value = JSON.parse(localStorage.getItem('amazon_bulk_ad_workspace_scope') ?? '{}') as { workspaceId?: string }; h.set('x-workspace-id', value.workspaceId || 'default'); }
    catch { h.set('x-workspace-id', 'default'); }
    return h;
  }, []);
  const load = useCallback(async (allocationId = selected) => {
    const query = new URLSearchParams(); if (allocationId) query.set('allocationId', allocationId);
    const response = await fetch(`/api/operations/settlement-allocations?${query}`, { headers: headers(), cache: 'no-store' });
    const result = await response.json(); if (!response.ok) throw Error(result.error ?? '分摊批次读取失败。');
    setData(result); return result as Result;
  }, [headers, selected]);
  useEffect(() => { void load().catch(cause => setError(cause instanceof Error ? cause.message : '分摊批次读取失败。')); }, [load]);
  useEffect(() => {
    const reset = () => { setSelected(''); setData({ allocations: [], lines: [], truncated: { allocations: false, lines: false }, limits: { allocations: 100, lines: 5000 } }); void load('').catch(() => {}); };
    window.addEventListener(workspaceScopeChangedEventName, reset);
    return () => window.removeEventListener(workspaceScopeChangedEventName, reset);
  }, [load]);
  async function send(body: Record<string, unknown>) {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/operations/settlement-allocations', { method: 'POST', headers: headers(), body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw Error(result.error ?? '分摊操作失败。');
      const id = (result.allocationId as string) || selected;
      if (body.action === 'stage') setSelected(id);
      setNotice(result.reused ? '相同输入的批次已存在，已幂等复用。' : body.action === 'stage' ? '分摊批次已生成（未过账）。' : '操作已保存并记录审计。');
      await load(id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '分摊操作失败。'); }
    finally { setBusy(false); }
  }
  const current = data.allocations.find(row => row.id === selected);

  return <div data-testid="settlement-allocation-workbench">
    <ListPageTemplate
      header={<div className="space-y-2"><p className="text-body text-muted">仅对「已发布结算报告 + 已确认站点归属」的行做 SKU 分摊；未知归属行保持隔离。分摊结果只是本地计算，<strong>不会自动过账</strong>，也不会创建凭证或往来项；交接须由有审批权限的成员显式登记引用。金额全程六位定点计算，不调用 Amazon 接口。</p>{error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}{notice && <p role="status" className="text-sm text-success-ink">{notice}</p>}</div>}
      filters={canCreate ? <section className="space-y-2 border-b border-border pb-4"><h2 className="text-section">生成 SKU 分摊批次</h2>
      <form className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => { event.preventDefault(); void send({ action: 'stage', settlementReportId: form.settlementReportId, settlementId: form.settlementId, currency: form.currency, marketplaceId: form.marketplaceId, remainderPolicy: form.remainderPolicy, controlTotal: form.controlTotal || undefined, evidence: form.evidence }); }}>
        <label className="grid gap-1 text-xs">结算报告 ID<input required aria-label="结算报告 ID" className={cls} value={form.settlementReportId} onChange={event => setForm({ ...form, settlementReportId: event.target.value })} /></label>
        <label className="grid gap-1 text-xs">结算号<input required aria-label="结算号" className={cls} value={form.settlementId} onChange={event => setForm({ ...form, settlementId: event.target.value })} /></label>
        <label className="grid gap-1 text-xs">币种<input required aria-label="结算币种" className={cls} value={form.currency} onChange={event => setForm({ ...form, currency: event.target.value })} /></label>
        <label className="grid gap-1 text-xs">站点 ID<input required aria-label="站点 ID" className={cls} value={form.marketplaceId} onChange={event => setForm({ ...form, marketplaceId: event.target.value })} /></label>
        <label className="grid gap-1 text-xs">尾差策略<select aria-label="尾差策略" className={cls} value={form.remainderPolicy} onChange={event => setForm({ ...form, remainderPolicy: event.target.value })}><option value="LARGEST_REMAINDER">最大余数法（保证精确配平）</option><option value="MAX_PRINCIPAL_SKU">归本金最大 SKU（复刻上游）</option></select></label>
        <label className="grid gap-1 text-xs">结算控制总额（可选）<input aria-label="结算控制总额" className={cls} placeholder="留空则不做控制总额校验" value={form.controlTotal} onChange={event => setForm({ ...form, controlTotal: event.target.value })} /></label>
        <label className="grid gap-1 text-xs sm:col-span-2">分摊来源依据<input required aria-label="分摊来源依据" className={cls} value={form.evidence} onChange={event => setForm({ ...form, evidence: event.target.value })} /></label>
        <Button size="sm" disabled={busy}>计算并暂存</Button>
      </form>
    </section> : undefined}
      table={<>
    <section className="space-y-2 border-b border-border pb-4"><div className="flex flex-wrap items-center gap-2"><h2 className="mr-2 text-section">分摊批次</h2><label className="grid gap-1 text-xs text-muted">查看明细<select aria-label="选择分摊批次" className={cls} value={selected} onChange={event => { setSelected(event.target.value); void load(event.target.value).catch(cause => setError(cause.message)); }}><option value="">仅看批次列表</option>{data.allocations.map(row => <option key={row.id} value={row.id}>{row.settlementId} · {row.currency} · {statusNames[row.status] ?? row.status}</option>)}</select></label></div>
      <StandardDataTable
        ariaLabel="分摊批次列表"
        rows={data.allocations}
        getRowKey={(row) => row.id}
        columns={allocationColumns}
        empty="当前工作区暂无分摊批次。结算报告须先发布且站点归属已确认。"
      />
      {data.truncated.allocations && <p className="text-xs text-warning-ink">批次超过 {data.limits.allocations} 条，仅显示最近记录。</p>}
    </section>

    {current && <section className="space-y-2 border-b border-border pb-4"><h2 className="text-section">批次明细 · {current.settlementId}</h2>
      <p className="text-xs text-muted">输入摘要 {current.inputDigest.slice(0, 16)}… · 依据：{current.evidence}</p>
      {current.reconciliation?.total && <p className="text-xs">原始行合计 {current.reconciliation.total.originalTotal} · 本金 {current.reconciliation.total.principalTotal} · 8 类费用池 {current.reconciliation.total.feePoolsTotal} {current.currency}</p>}
      <StandardDataTable
        ariaLabel={`批次 ${current.settlementId} 的 SKU 分摊明细`}
        rows={data.lines}
        getRowKey={(line) => line.id}
        columns={lineColumns}
        empty="该批次无 SKU 分摊明细。"
      />
      {data.truncated.lines && <p className="text-xs text-warning-ink">明细超过 {data.limits.lines} 行，仅显示前 {data.limits.lines} 行。</p>}
      {canApprove && current.status === 'STAGED' && <form className="flex flex-wrap items-end gap-2 pt-2" onSubmit={event => { event.preventDefault(); void send({ action: 'publish', allocationId: current.id, openItemId: publish.openItemId || undefined, settlementRef: publish.settlementRef || undefined, evidence: publish.evidence }); }}>
        <strong className="text-xs basis-full">显式交接财务（只登记引用，不生成凭证）</strong>
        <label className="grid gap-1 text-xs">往来项 ID<input aria-label="交接往来项 ID" className={cls} value={publish.openItemId} onChange={event => setPublish({ ...publish, openItemId: event.target.value })} /></label>
        <label className="grid gap-1 text-xs">核销记录 ID<input aria-label="交接核销记录 ID" className={cls} value={publish.settlementRef} onChange={event => setPublish({ ...publish, settlementRef: event.target.value })} /></label>
        <label className="grid gap-1 text-xs grow">交接依据<input required aria-label="交接依据" className={cls} value={publish.evidence} onChange={event => setPublish({ ...publish, evidence: event.target.value })} /></label>
        <Button size="sm" disabled={busy}>登记交接</Button>
      </form>}
      {canApprove && current.status !== 'REVERSED' && <form className="flex flex-wrap items-end gap-2 pt-2" onSubmit={event => { event.preventDefault(); void send({ action: 'reverse', allocationId: current.id, evidence: reverseEvidence }); }}>
        <label className="grid gap-1 text-xs grow">冲销依据<input required aria-label="冲销依据" className={cls} value={reverseEvidence} onChange={event => setReverseEvidence(event.target.value)} /></label>
        <Button size="sm" variant="secondary" disabled={busy}>冲销批次</Button>
      </form>}
    </section>}
      </>}
    />
  </div>;
}
