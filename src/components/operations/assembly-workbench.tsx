"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";

const scopeKey = "tiaotiao.workspace.scope";
function workspaceId() { try { return (JSON.parse(localStorage.getItem(scopeKey) ?? "{}") as { workspaceId?: string }).workspaceId || "default"; } catch { return "default"; } }
function headers(json = false) { const result = new Headers({ "x-workspace-id": workspaceId() }); if (json) result.set("content-type", "application/json"); return result; }

type Product = { id: string; sku: string; chineseName: string };
type Location = { id: string; code: string; warehouseId: string; warehouse: { name: string } };
type BomLine = { id: string; componentProductRecordId: string; quantityPer: number; component: Product };
type Bom = { id: string; productRecordId: string; version: string; enabled: boolean; revision: number; product: Product; lines: BomLine[] };
type OrderLine = { id: string; componentProductRecordId: string; plannedQty: number; consumedQty: number; unitCost: string; amount: string; lotId: string; component: Product };
type AssemblyOrder = {
  id: string; number: string; status: string; plannedQty: number; outputQty: number;
  componentCost: string; unitCost: string; currency: string; revision: number; createdAt: string;
  product: Product; targetLocation: { id: string; code: string; warehouseId: string }; lines: OrderLine[];
};
type PendingApproval = { id: string; revision: number; status: string; requestedBy: string };

const statusLabels: Record<string, string> = { DRAFT: "草稿", COMPLETED: "已完成", CANCELLED: "已作废" };
const inputCls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const money = (value: string | number) => Number(value).toFixed(2);
const today = () => new Date().toISOString().slice(0, 10);

export function AssemblyWorkbench() {
  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [boms, setBoms] = useState<Bom[]>([]);
  const [orders, setOrders] = useState<AssemblyOrder[]>([]);
  const [approvals, setApprovals] = useState<Record<string, PendingApproval>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const [bomForm, setBomForm] = useState({ productRecordId: "", version: "V1" });
  const [bomLines, setBomLines] = useState<Array<{ componentProductRecordId: string; quantityPer: string }>>([{ componentProductRecordId: "", quantityPer: "1" }]);

  const [orderForm, setOrderForm] = useState({ productRecordId: "", bomId: "", locationId: "", plannedQty: "1" });
  const [expanded, setExpanded] = useState<string>("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const [optionsResponse, bomResponse, orderResponse] = await Promise.all([
        fetch("/api/operations/assembly?kind=options", { headers: headers(), cache: "no-store" }),
        fetch("/api/operations/assembly?kind=boms", { headers: headers(), cache: "no-store" }),
        fetch("/api/operations/assembly?kind=orders", { headers: headers(), cache: "no-store" }),
      ]);
      const options = await optionsResponse.json();
      const bomData = await bomResponse.json();
      const orderData = await orderResponse.json();
      if (!optionsResponse.ok) throw new Error(options.error ?? "基础资料读取失败。");
      if (!bomResponse.ok) throw new Error(bomData.error ?? "BOM 读取失败。");
      if (!orderResponse.ok) throw new Error(orderData.error ?? "组装单读取失败。");
      setProducts(options.products ?? []);
      setLocations(options.locations ?? []);
      setBoms(bomData.items ?? []);
      setOrders(orderData.items ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败。"); }
    finally { setBusy(false); }
  }, []);

  const loadApprovals = useCallback(async () => {
    try {
      const response = await fetch("/api/operations/wms/approvals?status=PENDING&limit=100", { headers: headers(), cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      const map: Record<string, PendingApproval> = {};
      for (const item of (data.items ?? []) as Array<PendingApproval & { action?: string; aggregateId?: string }>) {
        if (item.action === "ASSEMBLY_COMPLETE" && item.aggregateId) map[item.aggregateId] = item;
      }
      setApprovals(map);
    } catch { /* 审批列表是辅助信息，失败不阻断主流程 */ }
  }, []);

  useEffect(() => { void load(); void loadApprovals(); }, [load, loadApprovals]);

  const bomsForProduct = useMemo(() => boms.filter(bom => bom.productRecordId === orderForm.productRecordId), [boms, orderForm.productRecordId]);

  function addBomLine() { setBomLines(rows => [...rows, { componentProductRecordId: "", quantityPer: "1" }]); }
  function removeBomLine(index: number) { setBomLines(rows => rows.filter((_, position) => position !== index)); }
  function patchBomLine(index: number, patch: Partial<{ componentProductRecordId: string; quantityPer: string }>) {
    setBomLines(rows => rows.map((row, position) => position === index ? { ...row, ...patch } : row));
  }

  async function createBom(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    if (!bomForm.productRecordId) { setError("请选择成品。"); return; }
    const lines = bomLines
      .filter(row => row.componentProductRecordId)
      .map(row => ({ componentProductRecordId: row.componentProductRecordId, quantityPer: Number(row.quantityPer) }));
    if (!lines.length) { setError("至少选择一个组件。"); return; }
    if (lines.some(line => !Number.isInteger(line.quantityPer) || line.quantityPer < 1)) { setError("单位用量必须是大于 0 的整数。"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/operations/assembly", { method: "POST", headers: headers(true), body: JSON.stringify({ kind: "bom", productRecordId: bomForm.productRecordId, version: bomForm.version, lines }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "BOM 创建失败。");
      setNotice(`BOM 已创建（${data.item.version}）。`);
      setBomLines([{ componentProductRecordId: "", quantityPer: "1" }]);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "BOM 创建失败。"); }
    finally { setBusy(false); }
  }

  async function toggleBom(bom: Bom) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/assembly", { method: "PATCH", headers: headers(true), body: JSON.stringify({ kind: "bom", id: bom.id, enabled: !bom.enabled, revision: bom.revision }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "BOM 状态更新失败。");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "BOM 状态更新失败。"); }
    finally { setBusy(false); }
  }

  async function createOrder(event: React.FormEvent) {
    event.preventDefault();
    setError(""); setNotice("");
    if (!orderForm.productRecordId) { setError("请选择成品。"); return; }
    if (!orderForm.locationId) { setError("请选择成品入库库位。"); return; }
    const plannedQty = Number(orderForm.plannedQty);
    if (!Number.isInteger(plannedQty) || plannedQty < 1) { setError("计划产量必须是大于 0 的整数。"); return; }
    const location = locations.find(row => row.id === orderForm.locationId);
    if (!location) { setError("库位不存在。"); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/operations/assembly", {
        method: "POST", headers: headers(true),
        body: JSON.stringify({
          kind: "order",
          number: `ASM-${today().replace(/-/g, "")}-${String(orders.length + 1).padStart(3, "0")}`,
          productRecordId: orderForm.productRecordId,
          bomId: orderForm.bomId || undefined,
          warehouseId: location.warehouseId,
          locationId: location.id,
          plannedQty,
          idempotencyKey: `asm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "组装单创建失败。");
      setNotice(`组装单 ${data.item.number} 已创建，组件已按批次分配（草稿不预占库存）。`);
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "组装单创建失败。"); }
    finally { setBusy(false); }
  }

  async function requestCompletion(order: AssemblyOrder) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/wms/approvals", {
        method: "POST", headers: headers(true),
        body: JSON.stringify({
          aggregateId: order.id,
          expectedRevision: order.revision,
          idempotencyKey: `asm-complete:${order.id}:${order.revision}`,
          payload: { action: "ASSEMBLY_COMPLETE", reason: `组装 ${order.number} 完成入库` },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "完成审批申请失败。");
      setNotice("已提交完成审批。需由他人批准后才会扣料并产出入库。");
      await loadApprovals();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "完成审批申请失败。"); }
    finally { setBusy(false); }
  }

  async function executeCompletion(order: AssemblyOrder, approvalId: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/wms/commands", {
        method: "POST", headers: headers(true),
        body: JSON.stringify({
          workspaceId: workspaceId(),
          aggregateId: order.id,
          expectedRevision: order.revision,
          idempotencyKey: `asm-complete:${order.id}:${order.revision}:exec`,
          payload: { action: "ASSEMBLY_COMPLETE", reason: `组装 ${order.number} 完成入库` },
          approvalId,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "组装完成执行失败。");
      const change = data.item?.assemblyChange as { outputQty?: number; unitCost?: string } | undefined;
      setNotice(`组装完成：产出 ${change?.outputQty ?? order.plannedQty} 件，单位成本 ${change?.unitCost ?? "-"}。`);
      await load(); await loadApprovals();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "组装完成执行失败。"); }
    finally { setBusy(false); }
  }

  async function cancelOrder(order: AssemblyOrder) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/assembly", { method: "PATCH", headers: headers(true), body: JSON.stringify({ kind: "order", id: order.id, revision: order.revision, reason: "经营调整" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "作废失败。");
      setNotice("组装单已作废。");
      await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "作废失败。"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">BOM 与组装</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              组装单草稿只做组件分配、不预占库存；完成需他人审批，扣料与产出入库在同一事务内完成。
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => { void load(); void loadApprovals(); }} disabled={busy}>刷新</Button>
        </div>
        {notice ? <p className="mt-3 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">{notice}</p> : null}
        {error ? <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">新增 BOM</h3>
        <form className="mt-3 space-y-3" onSubmit={createBom}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              成品
              <select className={`${inputCls} mt-1 block w-64`} value={bomForm.productRecordId} onChange={event => setBomForm({ ...bomForm, productRecordId: event.target.value })}>
                <option value="">选择成品 SKU</option>
                {products.map(product => <option key={product.id} value={product.id}>{product.sku} {product.chineseName}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              版本
              <input className={`${inputCls} mt-1 block w-28`} value={bomForm.version} onChange={event => setBomForm({ ...bomForm, version: event.target.value })} />
            </label>
            <Button type="button" variant="outline" size="sm" onClick={addBomLine}>加组件</Button>
          </div>
          <div className="space-y-2">
            {bomLines.map((row, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2">
                <select className={`${inputCls} w-64`} value={row.componentProductRecordId} onChange={event => patchBomLine(index, { componentProductRecordId: event.target.value })}>
                  <option value="">选择组件 SKU</option>
                  {products.filter(product => product.id !== bomForm.productRecordId).map(product => <option key={product.id} value={product.id}>{product.sku} {product.chineseName}</option>)}
                </select>
                <input className={`${inputCls} w-24`} value={row.quantityPer} onChange={event => patchBomLine(index, { quantityPer: event.target.value })} placeholder="每件用量" />
                <Button type="button" variant="ghost" size="sm" onClick={() => removeBomLine(index)} disabled={bomLines.length === 1}>删除</Button>
              </div>
            ))}
          </div>
          <Button type="submit" size="sm" disabled={busy}>保存 BOM</Button>
        </form>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr><th className="py-2">成品</th><th>版本</th><th>组件</th><th>状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {boms.length === 0 ? <tr><td className="py-3 text-muted-foreground" colSpan={5}>还没有 BOM。先给组合商品建一套。</td></tr> : null}
              {boms.map(bom => (
                <tr key={bom.id} className="border-t border-border/60">
                  <td className="py-2">{bom.product.sku} {bom.product.chineseName}</td>
                  <td>{bom.version}</td>
                  <td>{bom.lines.map(line => `${line.component.sku}×${line.quantityPer}`).join("、")}</td>
                  <td>{bom.enabled ? "启用" : "停用"}</td>
                  <td><Button variant="ghost" size="sm" onClick={() => void toggleBom(bom)} disabled={busy}>{bom.enabled ? "停用" : "启用"}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">新建组装单</h3>
        <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={createOrder}>
          <label className="text-xs text-muted-foreground">
            成品
            <select className={`${inputCls} mt-1 block w-64`} value={orderForm.productRecordId} onChange={event => setOrderForm({ ...orderForm, productRecordId: event.target.value, bomId: "" })}>
              <option value="">选择成品 SKU</option>
              {products.filter(product => boms.some(bom => bom.productRecordId === product.id && bom.enabled)).map(product => <option key={product.id} value={product.id}>{product.sku} {product.chineseName}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            BOM
            <select className={`${inputCls} mt-1 block w-32`} value={orderForm.bomId} onChange={event => setOrderForm({ ...orderForm, bomId: event.target.value })}>
              <option value="">最新启用</option>
              {bomsForProduct.map(bom => <option key={bom.id} value={bom.id}>{bom.version}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            成品库位
            <select className={`${inputCls} mt-1 block w-64`} value={orderForm.locationId} onChange={event => setOrderForm({ ...orderForm, locationId: event.target.value })}>
              <option value="">选择库位</option>
              {locations.map(location => <option key={location.id} value={location.id}>{location.warehouse.name} / {location.code}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            计划产量
            <input className={`${inputCls} mt-1 block w-24`} value={orderForm.plannedQty} onChange={event => setOrderForm({ ...orderForm, plannedQty: event.target.value })} />
          </label>
          <Button type="submit" size="sm" disabled={busy}>创建并分配组件</Button>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">组件按入库先后从同仓库可用库存取料；任一组件不足会整单拒绝，不会只扣一半。</p>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-semibold">组装单</h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-2">单号</th><th>成品</th><th>库位</th><th>计划/产出</th><th>组件成本</th><th>单位成本</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? <tr><td className="py-3 text-muted-foreground" colSpan={8}>还没有组装单。</td></tr> : null}
              {orders.map(order => {
                const approval = approvals[order.id];
                return (
                  <tr key={order.id} className="border-t border-border/60 align-top">
                    <td className="py-2">
                      <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setExpanded(expanded === order.id ? "" : order.id)}>
                        {order.number}
                      </button>
                    </td>
                    <td>{order.product.sku}</td>
                    <td>{order.targetLocation.code}</td>
                    <td>{order.plannedQty} / {order.outputQty}</td>
                    <td>{money(order.componentCost)}</td>
                    <td>{money(order.unitCost)}</td>
                    <td>{statusLabels[order.status] ?? order.status}</td>
                    <td className="space-x-2 whitespace-nowrap">
                      {order.status === "DRAFT" && !approval ? <Button variant="outline" size="sm" onClick={() => void requestCompletion(order)} disabled={busy}>申请完成</Button> : null}
                      {order.status === "DRAFT" && approval ? <Button size="sm" onClick={() => void executeCompletion(order, approval.id)} disabled={busy}>执行完成</Button> : null}
                      {order.status === "DRAFT" ? <Button variant="ghost" size="sm" onClick={() => void cancelOrder(order)} disabled={busy}>作废</Button> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {orders.map(order => expanded !== order.id ? null : (
          <div key={`detail-${order.id}`} className="mt-3 rounded border border-border/60 p-3">
            <p className="text-xs font-medium">组件明细</p>
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th>组件</th><th>用量/计划</th><th>耗用</th><th>单价</th><th>金额</th><th>批次</th></tr></thead>
              <tbody>
                {order.lines.map(line => (
                  <tr key={line.id} className="border-t border-border/40">
                    <td className="py-1">{line.component.sku}</td>
                    <td>{line.plannedQty}</td>
                    <td>{line.consumedQty}</td>
                    <td>{money(line.unitCost)}</td>
                    <td>{money(line.amount)}</td>
                    <td className="font-mono text-[11px] text-muted-foreground">{line.lotId.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
        <p className="mt-3 text-xs text-muted-foreground">
          审批中心批准后，回到这里点「执行完成」才会真正扣料产出。申请人不能自批，这是故意的。
        </p>
      </section>
    </div>
  );
}
