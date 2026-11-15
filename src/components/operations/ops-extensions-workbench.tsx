"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const scopeKey = "tiaotiao.workspace.scope";
function workspaceId() { try { return (JSON.parse(localStorage.getItem(scopeKey) ?? "{}") as { workspaceId?: string }).workspaceId || "default"; } catch { return "default"; } }
function headers(json = false) { const result = new Headers({ "x-workspace-id": workspaceId() }); if (json) result.set("content-type", "application/json"); return result; }

type Carrier = { id: string; code: string; name: string; serviceLevel: string; contactName: string; trackingUrlPattern: string; enabled: boolean; notes: string; revision: number };
type ThirdPartyWarehouse = { id: string; code: string; name: string; provider: string; accountRef: string; region: string; status: string; enabled: boolean; notes: string; revision: number };
type WmsWarehouse = { id: string; code: string; name: string };
type Assessment = { id: string; warehouseId: string; asOfDate: string; recordCount: number; slowDays: number; minSalesQty: number; sourceHash: string; policyReference: string; records: Array<{ sku: string; onHand: number; ageDays: number; salesQty: number; level: string; action: string }> };

const inputCls = "h-9 min-w-0 rounded border border-border bg-background px-2 text-sm";
const levelLabels: Record<string, string> = { NORMAL: "正常", SLOW: "慢动", UNSALABLE: "滞销" };
const today = () => new Date().toISOString().slice(0, 10);

const blankCarrier = { code: "", name: "", serviceLevel: "", contactName: "", trackingUrlPattern: "", enabled: true, notes: "" };
const blankWarehouse = { code: "", name: "", provider: "", accountRef: "", region: "", status: "ACTIVE", enabled: true, notes: "" };

export function OpsExtensionsWorkbench() {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [warehouses, setWarehouses] = useState<ThirdPartyWarehouse[]>([]);
  const [wmsWarehouses, setWmsWarehouses] = useState<WmsWarehouse[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [carrier, setCarrier] = useState({ ...blankCarrier });
  const [warehouse, setWarehouse] = useState({ ...blankWarehouse });
  const [editCarrierId, setEditCarrierId] = useState("");
  const [editWarehouseId, setEditWarehouseId] = useState("");
  const [capture, setCapture] = useState({ warehouseId: "", asOfDate: today(), policyReference: "库龄 ≥ 90 天且近 90 天销量为 0 判滞销", slowDays: "90", minSalesQty: "0", salesWindowDays: "90" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [c, w, o, a] = await Promise.all([
        fetch("/api/operations/ops-extensions?kind=carriers", { headers: headers(), cache: "no-store" }),
        fetch("/api/operations/ops-extensions?kind=warehouses", { headers: headers(), cache: "no-store" }),
        fetch("/api/operations/ops-extensions?kind=options", { headers: headers(), cache: "no-store" }),
        fetch("/api/operations/ops-extensions?kind=assessments", { headers: headers(), cache: "no-store" }),
      ]);
      const [cd, wd, od, ad] = await Promise.all([c.json(), w.json(), o.json(), a.json()]);
      for (const [response, data, label] of [[c, cd, "承运商"], [w, wd, "三方仓"], [o, od, "仓库选项"], [a, ad, "滞销快照"]] as const) {
        if (!response.ok) throw new Error(`${data.error ?? `${label}读取失败`}`);
      }
      setCarriers(cd.items ?? []);
      setWarehouses(wd.items ?? []);
      setWmsWarehouses(od.wmsWarehouses ?? []);
      setAssessments(ad.items ?? []);
      setCapture(current => ({ ...current, warehouseId: current.warehouseId || od.wmsWarehouses?.[0]?.id || "" }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "读取失败。"); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(body: Record<string, unknown>, message: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/operations/ops-extensions", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "保存失败。");
      setNotice(message);
      await load();
      return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败。"); return false; }
    finally { setBusy(false); }
  }

  function field(label: string, value: string, onChange: (value: string) => void, placeholder = "") {
    return <label key={label} className="grid gap-1 text-xs">{label}<input className={inputCls} value={value} placeholder={placeholder} onChange={event => onChange(event.target.value)} /></label>;
  }

  return <div className="space-y-6">
    {error && <p role="alert" className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}
    {notice && <p className="rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{notice}</p>}

    <section className="space-y-3">
      <div><h2 className="text-sm font-semibold">承运商主数据</h2><p className="text-xs text-muted">把头程与海外调拨里的自由文本承运商收敛为可维护资料；编码在同一工作区唯一。</p></div>
      <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" onSubmit={async event => {
        event.preventDefault();
        const ok = await act({ action: editCarrierId ? "update-carrier" : "create-carrier", ...(editCarrierId ? { id: editCarrierId, revision: carriers.find(row => row.id === editCarrierId)?.revision } : {}), ...carrier }, editCarrierId ? "承运商已更新。" : "承运商已创建。");
        if (ok) { setCarrier({ ...blankCarrier }); setEditCarrierId(""); }
      }}>
        {field("编码", carrier.code, value => setCarrier(current => ({ ...current, code: value })), "MATSON")}
        {field("名称", carrier.name, value => setCarrier(current => ({ ...current, name: value })))}
        {field("时效", carrier.serviceLevel, value => setCarrier(current => ({ ...current, serviceLevel: value })), "快船")}
        {field("联系人", carrier.contactName, value => setCarrier(current => ({ ...current, contactName: value })))}
        {field("轨迹地址", carrier.trackingUrlPattern, value => setCarrier(current => ({ ...current, trackingUrlPattern: value })), "https://…/{trackingNo}")}
        <div className="flex items-end gap-2"><Button size="sm" disabled={busy}>{editCarrierId ? "保存修改" : "新增承运商"}</Button>{editCarrierId && <Button size="sm" variant="ghost" type="button" onClick={() => { setEditCarrierId(""); setCarrier({ ...blankCarrier }); }}>取消</Button>}</div>
      </form>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-muted"><tr>{["编码", "名称", "时效", "联系人", "状态", "操作"].map(head => <th key={head} className="pb-1 font-medium">{head}</th>)}</tr></thead><tbody>{carriers.map(row => <tr key={row.id} className="border-t border-border">
        <td className="py-1.5 font-mono">{row.code}</td><td>{row.name}</td><td>{row.serviceLevel || "—"}</td><td>{row.contactName || "—"}</td>
        <td>{row.enabled ? "启用" : "停用"}</td>
        <td><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => { setEditCarrierId(row.id); setCarrier({ code: row.code, name: row.name, serviceLevel: row.serviceLevel, contactName: row.contactName, trackingUrlPattern: row.trackingUrlPattern, enabled: row.enabled, notes: row.notes }); }}>编辑</Button><Button size="sm" variant="ghost" onClick={() => void act({ action: "update-carrier", id: row.id, revision: row.revision, code: row.code, name: row.name, serviceLevel: row.serviceLevel, contactName: row.contactName, trackingUrlPattern: row.trackingUrlPattern, enabled: !row.enabled, notes: row.notes }, row.enabled ? "承运商已停用。" : "承运商已启用。")}>{row.enabled ? "停用" : "启用"}</Button></div></td>
      </tr>)}</tbody></table></div>
    </section>

    <section className="space-y-3">
      <div><h2 className="text-sm font-semibold">三方仓账户</h2><p className="text-xs text-muted">外部仓对接身份与状态；库存余额仍以 WMS 自身为准，不在此处做双写。</p></div>
      <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" onSubmit={async event => {
        event.preventDefault();
        const ok = await act({ action: editWarehouseId ? "update-warehouse" : "create-warehouse", ...(editWarehouseId ? { id: editWarehouseId, revision: warehouses.find(row => row.id === editWarehouseId)?.revision } : {}), ...warehouse }, editWarehouseId ? "三方仓已更新。" : "三方仓已创建。");
        if (ok) { setWarehouse({ ...blankWarehouse }); setEditWarehouseId(""); }
      }}>
        {field("编码", warehouse.code, value => setWarehouse(current => ({ ...current, code: value })), "3PL-US-1")}
        {field("名称", warehouse.name, value => setWarehouse(current => ({ ...current, name: value })))}
        {field("服务商", warehouse.provider, value => setWarehouse(current => ({ ...current, provider: value })))}
        {field("对接账户", warehouse.accountRef, value => setWarehouse(current => ({ ...current, accountRef: value })))}
        {field("区域", warehouse.region, value => setWarehouse(current => ({ ...current, region: value })))}
        <div className="flex items-end gap-2"><Button size="sm" disabled={busy}>{editWarehouseId ? "保存修改" : "新增三方仓"}</Button>{editWarehouseId && <Button size="sm" variant="ghost" type="button" onClick={() => { setEditWarehouseId(""); setWarehouse({ ...blankWarehouse }); }}>取消</Button>}</div>
      </form>
      <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-muted"><tr>{["编码", "名称", "服务商", "账户", "区域", "状态"].map(head => <th key={head} className="pb-1 font-medium">{head}</th>)}</tr></thead><tbody>{warehouses.map(row => <tr key={row.id} className="border-t border-border">
        <td className="py-1.5 font-mono">{row.code}</td><td>{row.name}</td><td>{row.provider}</td><td>{row.accountRef || "—"}</td><td>{row.region || "—"}</td>
        <td><Button size="sm" variant="ghost" onClick={() => { setEditWarehouseId(row.id); setWarehouse({ code: row.code, name: row.name, provider: row.provider, accountRef: row.accountRef, region: row.region, status: row.status, enabled: row.enabled, notes: row.notes }); }}>{row.status} / 编辑</Button></td>
      </tr>)}</tbody></table></div>
    </section>

    <section className="space-y-3">
      <div><h2 className="text-sm font-semibold">滞销判定快照</h2><p className="text-xs text-muted">只读在库量、批次库龄与窗口销量；库龄超阈值且窗口销量低于下限判滞销。同一仓库同一天不会静默覆盖。</p></div>
      <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6" onSubmit={event => {
        event.preventDefault();
        void act({ action: "capture-unsalable", ...capture, slowDays: Number(capture.slowDays), minSalesQty: Number(capture.minSalesQty), salesWindowDays: Number(capture.salesWindowDays) }, "滞销快照已固化。");
      }}>
        <label className="grid gap-1 text-xs">仓库<select className={inputCls} value={capture.warehouseId} onChange={event => setCapture(current => ({ ...current, warehouseId: event.target.value }))}><option value="">选择仓库</option>{wmsWarehouses.map(row => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></label>
        {field("判定日期", capture.asOfDate, value => setCapture(current => ({ ...current, asOfDate: value })))}
        {field("库龄阈值（天）", capture.slowDays, value => setCapture(current => ({ ...current, slowDays: value })))}
        {field("窗口销量下限", capture.minSalesQty, value => setCapture(current => ({ ...current, minSalesQty: value })))}
        {field("销量窗口（天）", capture.salesWindowDays, value => setCapture(current => ({ ...current, salesWindowDays: value })))}
        <div className="flex items-end"><Button size="sm" disabled={busy || !capture.warehouseId}>生成快照</Button></div>
      </form>
      <label className="grid gap-1 text-xs">口径依据<input className={inputCls} value={capture.policyReference} onChange={event => setCapture(current => ({ ...current, policyReference: event.target.value }))} /></label>
      {assessments.map(row => <details key={row.id} className="rounded border border-border p-3 text-xs">
        <summary className="cursor-pointer text-brand">{row.asOfDate} · 仓库 {wmsWarehouses.find(item => item.id === row.warehouseId)?.code ?? row.warehouseId} · {row.recordCount} 个 SKU · 库龄 ≥ {row.slowDays} 天 / 销量 ≤ {row.minSalesQty}</summary>
        <p className="mt-2 text-muted">口径：{row.policyReference}</p>
        <p className="text-muted">来源摘要 {row.sourceHash.slice(0, 16)}…</p>
        {row.records.length ? <table className="mt-2 w-full min-w-[600px] text-left"><thead className="text-muted"><tr>{["SKU", "在库", "库龄", "窗口销量", "判定", "建议"].map(head => <th key={head} className="pb-1 font-medium">{head}</th>)}</tr></thead><tbody>{row.records.map(item => <tr key={item.sku} className="border-t border-border"><td className="py-1 font-mono">{item.sku}</td><td>{item.onHand}</td><td>{item.ageDays} 天</td><td>{item.salesQty}</td><td className={item.level === "UNSALABLE" ? "text-red-800" : ""}>{levelLabels[item.level] ?? item.level}</td><td>{item.action}</td></tr>)}</tbody></table> : <p className="mt-2">该仓库暂无在库 SKU。</p>}
      </details>)}
    </section>
  </div>;
}
