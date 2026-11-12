"use client";

import {FbaCustomsSettings} from './fba-customs-settings';

import {FbaRemoteActions} from './fba-remote-actions';
import { FbaWorkflowOptions } from './fba-workflow-options';
import { FbaExternalOperationRecords } from './fba-external-operation-records';
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import type { FbaLocalPlansResult } from "@/lib/fba-local/service";
import { batchLines, runPlanBatch, type PlanBatchAction } from "@/lib/fba-local/batch";
import { Button } from "@/components/ui/button";
import { WorkbenchDialog } from "@/components/ui/workbench-dialog";
import { FbaPlanTable } from "./fba-plan-table";
import { FbaLocalCostForm } from "./fba-local-cost-form";
import { FbaLocalTransport } from "./fba-local-transport";
import { FbaLocalShipmentLinks } from "./fba-local-shipment-links";
import { FbaLocalFinanceDrafts } from './fba-local-finance-drafts';
import { FbaLocalShipmentDocuments } from './fba-local-shipment-documents';
import { FbaLocalCustoms } from './fba-local-customs';
import { FbaLocalPackingForm } from "./fba-local-packing-form";
import { FbaLocalPlanForm } from "./fba-local-plan-form";
import { WmsReservationStock } from "./wms-reservation-stock";

type Plan = FbaLocalPlansResult["items"][number];
type Line = Plan["lines"][number];
const statusLabels: Record<string, string> = { DRAFT: "草稿", ACTIVE: "库存交接中", CANCELLED: "已取消", NEEDS_RESERVATION: "待预占", RESERVED: "已预占", RELEASED: "已释放", PARTIALLY_RELEASED: "部分释放", SHORTFALL: "存在释放差额", PARTIALLY_RESERVED: "部分预占", AWAITING_PICK: "待拣货", PARTIALLY_PICKED: "部分已拣", AWAITING_DISPATCH: "待出库", CLOSED: "已结束", DISPATCHED: "已出库", PARTIALLY_DISPATCHED: "部分出库", PENDING: "待主管审批", APPROVED: "已批准待执行", REJECTED: "已拒绝", CONSUMED: "已执行" };
const feeTypeLabels: Record<string,string> = {OCEAN:'海运费',AIR:'空运费',FUEL:'燃油附加',CUSTOMS:'报关费',CLEARANCE:'清关费',INSURANCE:'保险',TRUCKING:'拖车费',OTHER:'其他'};

export function FbaLocalPlansWorkbench({ sellerAccountId, marketplaceId, getHeaders, mode = "plans" }: { sellerAccountId: string; marketplaceId: string; getHeaders: () => Headers; mode?: "plans" | "packing" }) {
  const lineId = useSearchParams().get("lineId") ?? "";
  const [workspaceId, setWorkspaceId] = useState("");
  useEffect(() => {
    const update = () => setWorkspaceId(getHeaders().get("x-workspace-id") || "default");
    update(); window.addEventListener(workspaceScopeChangedEventName, update);
    return () => window.removeEventListener(workspaceScopeChangedEventName, update);
  }, [getHeaders]);
  if (!lineId && (!sellerAccountId || !marketplaceId)) return <p className="rounded border border-border bg-surface p-4 text-sm">请选择一个店铺和站点，查看或新建 FBA 本地计划。</p>;
  if (!workspaceId) return <p role="status">读取工作区…</p>;
  return <PlanWorkbench key={`${workspaceId}:${sellerAccountId}:${marketplaceId}:${lineId}`} mode={mode} lineId={lineId} workspaceId={workspaceId} sellerAccountId={sellerAccountId} marketplaceId={marketplaceId} />;
}

function PlanWorkbench({ workspaceId, sellerAccountId, marketplaceId, lineId, mode }: { workspaceId: string; sellerAccountId: string; marketplaceId: string; lineId: string; mode: "plans" | "packing" }) {
  const user = useAppShellUser();
  const canCreate = roleCanPerformAction(user?.userRole, "wms", "create", user?.rolePermissions);
  const canEdit = roleCanPerformAction(user?.userRole, "wms", "edit", user?.rolePermissions);
  const [result, setResult] = useState<FbaLocalPlansResult | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<"expanded" | "table">("expanded");
  const showList = mode === "packing" || displayMode === "table";
  const [page, setPage] = useState(1), [open, setOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [costPlan, setCostPlan] = useState<Plan | null>(null);
  const [ledgerPlan, setLedgerPlan] = useState<{plan: Plan; fee?: Plan['fees'][number]} | null>(null);
  const [packingPlan, setPackingPlan] = useState<Plan | null>(null);
  const [cancelling, setCancelling] = useState<Plan | null>(null);
  const sequence = useRef(0), lock = useRef(false), mounted = useRef(true);
  const load = useCallback(async () => {
    const epoch = ++sequence.current; setLoading(true); setError("");
    try {
      const params = new URLSearchParams(lineId ? { lineId } : { sellerAccountId, marketplaceId, page: String(page) });
      const response = await fetch(`/api/operations/fba-local-plans?${params}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
      const data = await response.json();
      if (epoch !== sequence.current) return;
      if (!response.ok) throw Error(data.error || "读取计划失败。");
      setResult(data);
    } catch (cause) { if (epoch === sequence.current) { setResult(null); setError(cause instanceof Error ? cause.message : "读取失败。"); } }
    finally { if (epoch === sequence.current) setLoading(false); }
  }, [workspaceId, sellerAccountId, marketplaceId, page, lineId]);
  const invalidate = useCallback(() => { mounted.current = false; ++sequence.current; }, []);
  useEffect(() => { mounted.current = true; void load(); return invalidate; }, [load, invalidate]);
  async function perform(path: string, body: unknown, message: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!mounted.current) return;
      if (!response.ok) throw Error(data.error || "操作失败，请刷新后核对。");
      setNotice(message); setCancelling(null); await load();
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function batch(plan: Plan, action: PlanBatchAction) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    let completed = 0, total = 0;
    const labels = { REQUEST: "申请预占", APPROVE: "批准预占", EXECUTE: "执行预占" };
    try {
      await runPlanBatch({ plan, action, userId: user?.userId ?? "", canEdit,
        active: () => mounted.current,
        progress: (done, count) => { completed = done; total = count; if (mounted.current) setNotice(`${labels[action]}：已完成 ${done}/${count} 条。`); },
        read: async () => {
          const params = new URLSearchParams(lineId ? { lineId, id: plan.id } : { sellerAccountId, marketplaceId, id: plan.id });
          const response = await fetch(`/api/operations/fba-local-plans?${params}`, { headers: { "x-workspace-id": workspaceId }, cache: "no-store" });
          const data = await response.json();
          if (!response.ok || !data.items?.[0]) throw Error(data.error || "计划已不可读取。");
          return data.items[0];
        },
        send: async (path, body) => {
          const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify(body) });
          const data = await response.json();
          if (!response.ok) throw Error(data.error || "操作失败，请刷新核对。");
        },
      });
    } catch (cause) {
      if (mounted.current) setNotice(`${labels[action]}已停止，收到成功响应 ${completed}/${total} 条；已成功操作保留。${cause instanceof Error ? cause.message : "请核对当前结果。"}`);
    } finally {
      if (mounted.current) await load();
      lock.current = false; if (mounted.current) setBusy(false);
    }
  }
  function reserve(plan: Plan, line: Line, execute: boolean) {
    void perform("/api/operations/fba-local-plans", { action: execute ? "EXECUTE_RESERVATION" : "REQUEST_RESERVATION", id: plan.id, expectedRevision: plan.revision, lineId: line.id,
      balanceRevision: execute ? line.approval!.balanceRevision : line.balance.revision, ...(execute ? { approvalId: line.approval!.id } : {}) }, execute ? "库存已预占，可前往公司仓库拣货与出库。" : "预占申请已提交，请另一名主管核对后批准。");
  }
  return <section className="space-y-4" aria-label="FBA 本地计划工作台"><FbaCustomsSettings workspaceId={workspaceId}/>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">{mode === "packing" ? "FBA 本地装箱" : "FBA 本地发货计划"}</h2><p className="mt-1 text-xs text-muted">创建计划 → 主管审批 → 预占库存 → 仓库拣货出库。Amazon 建货件尚未接入。</p></div><div className="flex gap-2"><Button variant="secondary" disabled={loading || busy} onClick={() => void load()}>刷新计划</Button>{canCreate && !lineId && <Button disabled={loading || busy || !!error} onClick={() => setOpen(true)}>新建本地计划</Button>}</div></div>
    {mode === "plans" && <div role="group" aria-label="发货计划显示方式" className="flex gap-2"><Button type="button" size="sm" variant="secondary" aria-pressed={displayMode === "table"} onClick={() => { setSelectedPlanId(null); setDisplayMode("table"); }}>单据列表</Button><Button type="button" size="sm" variant="secondary" aria-pressed={displayMode === "expanded"} onClick={() => { setSelectedPlanId(null); setDisplayMode("expanded"); }}>展开计划</Button></div>}
    {lineId && <p className="text-sm text-muted">当前显示仓库关联计划。<a className="ml-2 text-brand hover:underline" href="/operations?view=first-mile">返回全部计划</a></p>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}{notice && <p role="status" className="text-sm text-brand">{notice}</p>}
    {loading && <p role="status" className="text-sm text-muted">读取本地计划…</p>}
    {!loading && result?.items.length === 0 && <p className="py-8 text-center text-sm text-muted">当前店铺和站点暂无本地计划。</p>}
    {mode === "packing" && <>
      <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">本地装箱资料已接入。Amazon 装箱组生成、方案选择、标签与确认提交尚未接入；本地保存不代表 Amazon 已接受。</p>
      {result && !loading && <FbaPlanTable plans={result.items} disabled={busy} onSelect={setSelectedPlanId} />}
    </>}
    {mode === "plans" && displayMode === "table" && result && !loading && <FbaPlanTable purpose="shipping" plans={result.items} disabled={busy} onSelect={setSelectedPlanId} />}
    <PlanDetailContainer drawer={showList} open={selectedPlanId !== null && !!result?.items.some(plan => plan.id === selectedPlanId)} busy={busy || formBusy || !!costPlan || !!ledgerPlan || !!packingPlan || !!cancelling} onClose={() => setSelectedPlanId(null)}>
    {mode === "packing" && !result?.items.some(plan => plan.id === selectedPlanId) && <p role="status">当前计划暂不可读，请关闭详情并刷新列表。{error}</p>}
    {result?.items.filter(plan => !showList || plan.id === selectedPlanId).map(plan => {
      const owned = plan.createdBy === user?.userId;
      const cancellable = plan.status !== "CANCELLED" && plan.lines.every(line => !line.reservation || (line.reservation.releasedQty === line.quantity && line.reservation.dispatchedQty === 0 && line.reservation.pickedQty === 0));
      return <article key={plan.id} data-plan-id={plan.id} className="rounded-lg border border-border bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3"><div><strong>{plan.number}</strong><span className="ml-3 text-xs text-muted">{statusLabels[plan.status]} · {plan.lines.length} 条明细 · {statusLabels[plan.fulfillment.stage]}</span></div>{owned && canEdit && cancellable && <Button size="sm" variant="secondary" disabled={busy || loading} onClick={() => setCancelling(plan)}>取消计划</Button>}</header>
        <div className="space-y-2 border-b border-border px-3 py-2 text-sm" aria-label="计划装箱资料">
          <div className="flex items-center gap-3"><span>{plan.packing ? `已保存 ${plan.packing.boxes.length} 箱` : "尚未保存装箱资料"}</span>{owned && canEdit && plan.status !== "CANCELLED" && plan.fulfillment.dispatchedQty === 0 && plan.fulfillment.releasedQty === 0 && <Button size="sm" variant="secondary" disabled={busy || loading} onClick={() => setPackingPlan(plan)}>{plan.packing ? "修改装箱资料" : "填写装箱资料"}</Button>}</div>
          {plan.packing?.boxes.map(box => <div key={box.number} className="text-xs text-muted"><p>箱号 {box.number} · {box.lengthCm} × {box.widthCm} × {box.heightCm} cm · 毛重 {box.grossWeightKg} kg{box.netWeightKg?` · 净重 ${box.netWeightKg} kg`:""} · {box.items.reduce((sum, item) => sum + item.quantity, 0)} 件</p><ul className="mt-1 list-inside list-disc">{box.items.map(item => { const line = plan.lines.find(row => row.id === item.lineId)!; return <li key={item.lineId}>{line.stock?.warehouseCode} / {line.stock?.locationCode} / {line.stock?.lotCode} · {item.quantity} 件</li>; })}</ul></div>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          {([ ["REQUEST", "申请全部待预占"], ["APPROVE", "批准本计划待审明细"], ["EXECUTE", "执行全部已批预占"] ] as const).map(([action, label]) => {
            const count = batchLines(plan, action, user?.userId ?? "", canEdit).length;
            return count > 1 ? <Button key={action} size="sm" variant="secondary" disabled={busy || loading} onClick={() => void batch(plan, action)}>{label}（{count} 条）</Button> : null;
          })}
          {plan.lines.length > 1 && <span className="text-xs text-muted">逐条提交，失败即停止；已成功的明细保留，刷新后可继续。</span>}
        </div>
        <div className="space-y-2 border-b border-border px-3 py-2 text-sm" aria-label="计划费用分摊">
          <div className="flex items-center gap-3"><span>头程费用</span>{owned && canEdit && plan.status !== "CANCELLED" && plan.costAllocation?.stage !== "ACTUAL" && <Button size="sm" variant="secondary" disabled={busy || loading} onClick={() => setCostPlan(plan)}>{plan.costAllocation ? "修改费用分摊" : "填写费用分摊"}</Button>}</div>
          {plan.costAllocation ? <><p>{plan.costAllocation.reference} · {plan.costAllocation.stage === "ESTIMATE" ? "预估" : "实际账单·已锁定"} · {plan.costAllocation.currency} {plan.costAllocation.amount}</p><ul className="list-inside list-disc text-xs text-muted">{plan.costAllocation.lines.map(item => { const line = plan.lines.find(row => row.id === item.lineId)!; return <li key={item.lineId}>{line.stock?.locationCode} / {line.stock?.lotCode} · {item.quantity} 件 · 分摊 {item.allocatedAmount} · 单位成本 {item.unitCost} · 单价除法余数 {item.unitCostRemainder}</li>; })}</ul><p className="text-xs text-muted">费用记录不产生付款、存货估值或总账过账。</p></> : <p className="text-xs text-muted">尚未录入费用。</p>}
        </div>
        <FbaLocalTransport plan={plan} workspaceId={workspaceId} canEdit={owned&&canEdit} disabled={busy||loading} onSaved={()=>void load()}/>
        <FbaLocalShipmentLinks plan={plan} workspaceId={workspaceId} canEdit={owned&&canEdit} disabled={busy||loading} onSaved={()=>void load()}/>
        <FbaExternalOperationRecords plan={plan} workspaceId={workspaceId} userId={user?.userId??''} canEdit={owned&&canEdit} canReview={canEdit&&roleCanPerformAction(user?.userRole,'wms','approve',user?.rolePermissions)} onSaved={()=>void load()}/>
        <FbaRemoteActions planId={plan.id} revision={plan.revision} workspaceId={workspaceId}/>
        <FbaWorkflowOptions plan={plan} workspaceId={workspaceId} userId={user?.userId??''} canEdit={owned&&canEdit} canReview={canEdit&&roleCanPerformAction(user?.userRole,'wms','approve',user?.rolePermissions)} onSaved={()=>void load()}/>
        <FbaLocalShipmentDocuments plan={plan} workspaceId={workspaceId} canEdit={owned&&canEdit} disabled={busy||loading} onSaved={()=>void load()}/>
        <FbaLocalCustoms plan={plan} workspaceId={workspaceId} canEdit={owned&&canEdit} canReview={canEdit&&roleCanPerformAction(user?.userRole,'wms','approve',user?.rolePermissions)} userId={user?.userId??''} disabled={busy||loading} onSaved={()=>void load()}/>
        <div className="space-y-2 border-b border-border px-3 py-2 text-sm" aria-label="费用台账与货代对账">
          <div className="flex items-center gap-3"><span>费用台账与货代对账</span>{owned&&canEdit&&plan.status!=='CANCELLED'&&plan.fees.length<100&&<Button size="sm" variant="secondary" disabled={busy||loading} onClick={()=>setLedgerPlan({plan})}>新增独立费用</Button>}</div>
          {plan.fees.length===0&&<p className="text-xs text-muted">尚无独立费用记录。上方费用草稿保留在原入口。</p>}
          {plan.fees.map(fee=><div key={fee.id} className="space-y-1 rounded border border-border p-2" data-fee-id={fee.id}><div className="flex flex-wrap items-center gap-3"><span>{fee.number} · {feeTypeLabels[fee.feeType]} · 预估 {fee.estimate.currency} {fee.estimate.amount}</span>{!fee.bill&&owned&&canEdit&&plan.status!=='CANCELLED'&&<Button size="sm" variant="secondary" disabled={busy||loading} onClick={()=>setLedgerPlan({plan,fee})}>确认货代账单</Button>}</div>{fee.bill?<><p>{fee.bill.forwarder} / {fee.bill.number} · 实际 {fee.bill.actual.currency} {fee.bill.actual.amount} · 差额 {fee.bill.reconciliation.difference}</p><ul className="list-inside list-disc text-xs text-muted">{fee.bill.reconciliation.lines.map(line=><li key={line.lineId}>明细 {plan.lines.findIndex(item=>item.id===line.lineId)+1} · 预估 {line.estimatedAmount} → 实际 {line.actualAmount} · 差额 {line.difference}</li>)}</ul><p className="text-xs text-muted">{fee.bill.adjustment?`调整草稿 ${fee.bill.adjustment.id} · 待核算主体、科目及期间映射，尚未过账。`:'账单与预估一致，无需差额调整。'}</p><FbaLocalFinanceDrafts plan={plan} fee={fee} workspaceId={workspaceId} canEdit={owned&&canEdit} canReview={canEdit&&roleCanPerformAction(user?.userRole,'wms','approve',user?.rolePermissions)} userId={user?.userId??''} disabled={busy||loading} onSaved={()=>void load()}/></>:<p className="text-xs text-muted">待确认实际账单</p>}</div>)}
        </div>
        <div className="space-y-1 border-b border-border px-3 py-2 text-xs" aria-label="计划出库进度">
          <p>计划 {plan.fulfillment.plannedQty} · 待预占 {plan.fulfillment.unreservedQty} · 剩余预占 {plan.fulfillment.reservedQty} · 待拣 {plan.fulfillment.unpickedQty} · 已拣待出库 {plan.fulfillment.pickedQty} · 累计出库 {plan.fulfillment.dispatchedQty} · 已释放 {plan.fulfillment.releasedQty}</p>
          {plan.fulfillment.releasedQty > 0 && plan.status !== "CANCELLED" && <p className="text-amber-700">已释放数量不会自动补占；需核对差额，未出库计划可全部释放后取消重建。</p>}
          {plan.fulfillment.dispatchedQty > 0 && <p className="text-muted">出库仅表示公司仓实物扣减，Amazon 收货状态尚未接入。</p>}
          {plan.stockReady && <p className="text-muted">库存已就绪</p>}
        </div>
        <div className="overflow-auto"><table className="w-full min-w-[680px] text-left text-sm"><thead><tr>{["仓库 / 库位 / 批次", "计划数量", "库存进度", "审批状态", "操作"].map(label => <th key={label} className="p-3 font-medium">{label}</th>)}</tr></thead><tbody>{plan.lines.map(line => {
          const approval = line.approval;
          const expired = !!approval && new Date(String(approval.expiresAt)).getTime() <= Date.now();
          const stale = !!approval && approval.balanceRevision !== line.balance.revision;
          const mayRequest = !approval || expired || stale || approval.status === "REJECTED";
          return <tr key={line.id} data-plan-line-id={line.id} className="border-t border-border"><td className="p-3"><WmsReservationStock stock={line.stock} /></td><td className="p-3">{line.quantity}</td><td className="p-3">{statusLabels[line.progress.status]}{line.progress.warehouseStatus && <span className="ml-2 text-xs text-muted">{statusLabels[line.progress.warehouseStatus]}</span>}<span className="mt-1 block text-xs text-muted">预占 {line.progress.reservedQty} · 待拣 {line.progress.unpickedQty} · 已拣 {line.progress.pickedQty} · 出库 {line.progress.dispatchedQty} · 释放 {line.progress.releasedQty}</span></td><td className="p-3">{approval ? expired && approval.status !== "CONSUMED" ? "已过期，请重新申请" : !line.reservationId && stale ? "库存版本变化，请重新申请" : statusLabels[approval.status] : "未申请"}</td><td className="p-3"><div className="flex flex-wrap gap-2">
            {plan.status !== "CANCELLED" && !line.reservationId && <>
              {owned && canEdit && mayRequest && <Button size="sm" disabled={busy || loading} onClick={() => reserve(plan, line, false)}>{approval ? "重新申请预占" : "申请预占"}</Button>}
              {approval?.canDecide && !stale && <><Button size="sm" disabled={busy || loading} onClick={() => void perform("/api/operations/wms/approvals", { approvalId: approval.id, revision: approval.revision, decision: "APPROVE" }, "预占申请已批准，请申请人执行。")}>批准预占</Button><Button size="sm" variant="secondary" disabled={busy || loading} onClick={() => void perform("/api/operations/wms/approvals", { approvalId: approval.id, revision: approval.revision, decision: "REJECT" }, "预占申请已拒绝。")}>拒绝预占</Button></>}
              {owned && approval?.canExecute && !stale && <Button size="sm" disabled={busy || loading} onClick={() => reserve(plan, line, true)}>执行预占</Button>}
            </>}
            {line.reservationId && <a className="text-xs text-brand hover:underline" href={`/logistics/warehouse?tab=reservations&number=${encodeURIComponent(`FBA-LOCAL:${line.id}`)}`}>仓库拣货与出库</a>}
          </div></td></tr>;
        })}</tbody></table></div>
      </article>;
    })}
    </PlanDetailContainer>
    {!lineId && <div className="flex items-center justify-end gap-3 text-xs"><span>第 {page} 页</span><Button size="sm" variant="secondary" disabled={loading || busy || page <= 1} onClick={() => { setResult(null); setPage(value => value - 1); }}>上一页计划</Button><Button size="sm" variant="secondary" disabled={loading || busy || !result?.hasMore} onClick={() => { setResult(null); setPage(value => value + 1); }}>下一页计划</Button></div>}
    <WorkbenchDialog open={open} title="新建 FBA 本地计划" busy={formBusy} onClose={() => setOpen(false)}><FbaLocalPlanForm workspaceId={workspaceId} sellerAccountId={sellerAccountId} marketplaceId={marketplaceId} onBusyChange={setFormBusy} onClose={() => setOpen(false)} onCreated={message => { setOpen(false); setNotice(message); if (page !== 1) setPage(1); else void load(); }} /></WorkbenchDialog>
    <WorkbenchDialog open={!!costPlan} title="头程费用分摊" busy={formBusy} onClose={() => setCostPlan(null)}>{costPlan && <FbaLocalCostForm plan={costPlan} workspaceId={workspaceId} onBusyChange={setFormBusy} onSaved={() => { setCostPlan(null); setNotice("费用分摊草稿已保存，尚未过账。"); void load(); }} />}</WorkbenchDialog>
    <WorkbenchDialog open={!!ledgerPlan} title={ledgerPlan?.fee?'确认货代账单':'新增独立费用'} busy={formBusy} onClose={()=>setLedgerPlan(null)}>{ledgerPlan&&<FbaLocalCostForm key={ledgerPlan.fee?.id??ledgerPlan.plan.id} plan={ledgerPlan.plan} workspaceId={workspaceId} ledger={{fee:ledgerPlan.fee}} onBusyChange={setFormBusy} onSaved={()=>{setLedgerPlan(null);setNotice('费用台账已更新，差额调整尚未过账。');void load();}}/>}</WorkbenchDialog>
    <WorkbenchDialog open={!!packingPlan} title="本地装箱资料" busy={formBusy} onClose={() => setPackingPlan(null)}>{packingPlan && <FbaLocalPackingForm plan={packingPlan} workspaceId={workspaceId} onBusyChange={setFormBusy} onSaved={() => { setPackingPlan(null); setNotice("装箱资料已保存，尚未提交 Amazon。"); void load(); }} />}</WorkbenchDialog>
    <WorkbenchDialog open={!!cancelling} title="取消本地计划" busy={busy} onClose={() => setCancelling(null)}>{cancelling && <div className="space-y-3"><p>确认取消计划 {cancelling.number}？</p><Button disabled={busy} onClick={() => void perform("/api/operations/fba-local-plans", { action: "CANCEL", id: cancelling.id, expectedRevision: cancelling.revision }, "计划已取消。")}>确认取消计划</Button>{error && <p role="alert" className="text-red-600">{error}</p>}</div>}</WorkbenchDialog>
  </section>;
}

// Reuse the existing operational controls in both the plan page and packing drawer.
function PlanDetailContainer({ drawer, open, busy, onClose, children }: {
  drawer: boolean; open: boolean; busy: boolean; onClose: () => void; children: React.ReactNode;
}) {
  return drawer ? <WorkbenchDialog open={open} drawer title="本地计划与装箱详情" busy={busy} onClose={onClose}>{children}</WorkbenchDialog> : <>{children}</>;
}
