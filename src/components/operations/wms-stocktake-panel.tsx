"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WmsCommandInput, WmsCommandPayload } from "@/lib/wms/contracts";
import { Button } from "@/components/ui/button";
import { useWmsOptions } from "./use-wms-options";
import { WmsOptionsStatus } from "./wms-options-status";

type Line = { id: string; locationId: string; lotId: string; baselineOnHand?: number; countedQty: number | null; lot: { lotCode: string } };
type Detail = { summary?:Record<string,unknown>;id: string; number: string; status: string; revision: number; locations: Array<{ locationId: string; location: { code: string }; lines: Line[] }> };
export function WmsStocktakePanel({ workspaceId, stocktakeId, onChanged }: { workspaceId: string; stocktakeId: string | null; onChanged: () => void }) {
  const [warehouseId, setWarehouseId] = useState("");
  const [number, setNumber] = useState("");
  const [mode,setMode]=useState("SAMPLE"),[blind,setBlind]=useState(false),[selectionEvidence,setSelectionEvidence]=useState("");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState({ locationId: "", lotId: "", countedQty: "" });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const retry = useRef<{ fingerprint: string; command: WmsCommandInput } | null>(null);
  const warehouses = useWmsOptions("warehouses", workspaceId, true);
  const locations = useWmsOptions("locations", workspaceId, Boolean(warehouseId), new URLSearchParams({ warehouseId }).toString());
  const lots = useWmsOptions("lots", workspaceId, detail?.status === "COUNTING");
  const refresh = useCallback(async (id: string) => {
    const response = await fetch("/api/operations/wms/stocktakes?" + new URLSearchParams({ id }), { cache: "no-store", headers: { "x-workspace-id": workspaceId } });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "读取盘点单失败。");
    const row: Detail | null = data.items[0] ?? null;
    return row;
  }, [workspaceId]);
  useEffect(() => {
    let live = true;
    setDetail(null); setError(""); setNotice(""); setValues({});
    if (stocktakeId) void refresh(stocktakeId).then(row => {
      if (!live) return;
      setDetail(row);
      setValues(Object.fromEntries(row?.locations.flatMap(location => location.lines.map(line => [line.id, line.countedQty === null ? "" : String(line.countedQty)])) ?? []));
    }).catch(cause => { if (live) setError(String(cause.message)); });
    return () => { live = false; };
  }, [stocktakeId, refresh]);
  async function send(path: string, body: unknown) {
    const response = await fetch("/api/operations/wms/" + path, { method: "POST", headers: { "Content-Type": "application/json", "x-workspace-id": workspaceId }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "操作失败。");
    return data.item;
  }
  async function act(payload: WmsCommandPayload) {
    if (!detail || pending.current) return;
    pending.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const fingerprint = JSON.stringify([detail.id, detail.revision, payload]);
      const command = retry.current?.fingerprint === fingerprint ? retry.current.command : {
        workspaceId, aggregateId: detail.id, expectedRevision: detail.revision, idempotencyKey: crypto.randomUUID(), payload,
      };
      retry.current = { fingerprint, command };
      await send(payload.action === "STOCKTAKE_POST" ? "approvals" : "commands", command);
      retry.current = null;
      setNotice(payload.action === "STOCKTAKE_POST" ? "已提交独立审批，请在待审批中审核、执行。" : "操作成功。");
      const updated = await refresh(detail.id);
      setDetail(updated);
      setValues(current => Object.fromEntries(updated?.locations.flatMap(location => location.lines.map(line => [
        line.id, current[line.id] ?? (line.countedQty === null ? "" : String(line.countedQty)),
      ])) ?? []));
      onChanged();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "操作失败。"); }
    finally { pending.current = false; setBusy(false); }
  }
  async function downloadPrint(){if(!detail||busy)return;setBusy(true);setError('');try{const response=await fetch('/api/operations/wms-stocktake-print?'+new URLSearchParams({id:detail.id}),{headers:{'x-workspace-id':workspaceId},cache:'no-store'});if(!response.ok){const result=await response.json();throw Error(result.error??'打印导出失败。');}const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');try{link.href=url;link.download='stocktake.html';link.click();}finally{URL.revokeObjectURL(url);}}catch(cause){setError(cause instanceof Error?cause.message:'打印导出失败。');}finally{setBusy(false);}}
  const field = "h-9 rounded border border-input bg-background px-2";
  return <section aria-label="盘点作业" className="space-y-3 rounded border border-border p-3">
    <p className="text-sm text-muted-foreground">盘点期间库存仍可作业；账面变化后须取消重盘。单次最多 100 个库位批次，空值表示未实盘，零须明确录入。</p>
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <details><summary className="cursor-pointer text-sm">新建盘点单</summary>
      <form className="mt-3 flex flex-wrap items-end gap-3" onSubmit={async event => {
        event.preventDefault(); if (pending.current) return;
        pending.current = true; setBusy(true); setError("");
        try {
          const row = await send("stocktakes", { workspaceId, warehouseId, number, locationIds: mode === "FULL" ? [] : locationIds, mode, blind, selectionEvidence });
          setDetail(await refresh(row.id)); setValues({}); setNumber(""); onChanged();
        } catch (cause) { setError(cause instanceof Error ? cause.message : "创建失败。"); }
        finally { pending.current = false; setBusy(false); }
      }}>
        <label className="grid gap-1 text-sm">盘点单号<input className={field} required maxLength={120} value={number} onChange={event => setNumber(event.target.value)} /></label>
        <label className="grid gap-1 text-sm">仓库<select aria-label="盘点仓库" className={field} required value={warehouseId} onChange={event => { setWarehouseId(event.target.value); setLocationIds([]); }}><option value="">选择仓库</option>{warehouses.items.filter(row => row.enabled).map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.code)} · {String(row.name)}</option>)}</select></label>
        <select aria-label="盘点范围模式" className={field} value={mode} onChange={event=>setMode(event.target.value)}><option value="FULL">全盘</option><option value="SAMPLE">抽盘</option><option value="ACTIVITY">动销盘点</option></select>
        <label className="text-sm"><input type="checkbox" checked={blind} onChange={event=>setBlind(event.target.checked)}/>盲盘</label>
        {mode==='ACTIVITY'&&<input aria-label="动销盘点范围依据" className={field} required value={selectionEvidence} onChange={event=>setSelectionEvidence(event.target.value)}/>}
        <label className="grid gap-1 text-sm">盘点库位（可多选）<select aria-label="盘点库位（可多选）" className={field + " h-28 min-w-48"} multiple required={mode !== "FULL"} disabled={mode === "FULL"} value={locationIds} onChange={event => setLocationIds(Array.from(event.target.selectedOptions, option => option.value))}>{locations.items.filter(row => row.kind === "STORAGE" && row.enabled).map(row => <option key={String(row.id)} value={String(row.id)}>{String(row.code)}</option>)}</select></label>
        <Button size="sm" disabled={busy || (mode !== "FULL" && !locationIds.length) || locationIds.length > 100}>创建盘点单</Button>
        <WmsOptionsStatus label="仓库" options={warehouses} /><WmsOptionsStatus label="盘点库位" options={locations} />
      </form>
    </details>
    {detail && <fieldset disabled={busy} className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm"><strong>{detail.number}</strong><Button size="sm" variant="secondary" disabled={busy} onClick={()=>void downloadPrint()}>下载盘点打印单</Button><span>{detail.status} · 版本 {detail.revision}</span></div>
      {detail.summary&&<details><summary>仓库、库位及批次盘点汇总</summary><pre className="max-h-64 overflow-auto text-xs">{JSON.stringify(detail.summary,null,2)}</pre></details>}
      <div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>库位</th><th>批次</th><th>账面</th><th>实盘</th><th>差异</th></tr></thead><tbody>{detail.locations.flatMap(location => location.lines.map(line => <tr key={line.id}><td>{location.location.code}</td><td>{line.lot.lotCode}</td><td>{line.baselineOnHand ?? "盲盘隐藏"}</td><td>{detail.status === "COUNTING" ? <input className={field + " w-28"} aria-label={location.location.code + "/" + line.lot.lotCode + "实盘"} type="number" min="0" max="2147483647" step="1" value={values[line.id] ?? ""} onChange={event => setValues(current => ({ ...current, [line.id]: event.target.value }))} /> : line.countedQty ?? "未实盘"}</td><td>{line.baselineOnHand == null ? "盲盘隐藏" : (detail.status === "COUNTING" ? values[line.id] : line.countedQty) == null || (detail.status === "COUNTING" && !values[line.id]) ? "未确定" : Number(detail.status === "COUNTING" ? values[line.id] : line.countedQty) - line.baselineOnHand}</td></tr>))}</tbody></table></div>
      {!detail.locations.some(location => location.lines.length) && <p className="text-sm">当前盘点范围无账面库存。</p>}
      {detail.status === "COUNTING" && <>
        <Button size="sm" onClick={() => {
          const lines = detail.locations.flatMap(location => location.lines.filter(line => values[line.id] !== undefined && values[line.id] !== "").map(line => ({ locationId: line.locationId, lotId: line.lotId, countedQty: Number(values[line.id]) })));
          if (!lines.length) { setError("请录入至少一条实盘数量。"); return; }
          void act({ action: "STOCKTAKE_COUNT", lines });
        }}>保存实盘</Button>
        <details><summary className="cursor-pointer text-sm">补录账外批次</summary><div className="flex flex-wrap gap-2 py-2">
          <select aria-label="账外库位" className={field} value={extra.locationId} onChange={event => setExtra({ ...extra, locationId: event.target.value })}><option value="">选择库位</option>{detail.locations.map(location => <option key={location.locationId} value={location.locationId}>{location.location.code}</option>)}</select>
          <select aria-label="账外批次" className={field} value={extra.lotId} onChange={event => setExtra({ ...extra, lotId: event.target.value })}><option value="">选择批次</option>{lots.items.map(lot => <option key={String(lot.id)} value={String(lot.id)}>{String(lot.lotCode)}</option>)}</select>
          <input aria-label="账外实盘数量" className={field + " w-28"} type="number" min="0" step="1" value={extra.countedQty} onChange={event => setExtra({ ...extra, countedQty: event.target.value })} />
          <Button size="sm" disabled={!extra.locationId || !extra.lotId || extra.countedQty === ""} onClick={() => void act({ action: "STOCKTAKE_COUNT", lines: [{ ...extra, countedQty: Number(extra.countedQty) }] })}>保存补录</Button><WmsOptionsStatus label="批次" options={lots} />
        </div></details>
      </>}
      <div className="flex flex-wrap gap-2">
        {detail.status === "DRAFT" && <Button size="sm" onClick={() => void act({ action: "STOCKTAKE_START" })}>开始盘点</Button>}
        {detail.status === "COUNTING" && <Button size="sm" onClick={() => void act({ action: "STOCKTAKE_REVIEW" })}>提交审核（以已保存实盘为准）</Button>}
        {detail.status === "REVIEW" && <Button size="sm" onClick={() => void act({ action: "STOCKTAKE_POST" })}>申请过账审批</Button>}
        {["DRAFT", "COUNTING", "REVIEW"].includes(detail.status) && <Button size="sm" variant="secondary" onClick={() => void act({ action: "STOCKTAKE_CANCEL" })}>取消盘点</Button>}
        <Button size="sm" variant="ghost" onClick={() => { void refresh(detail.id).then(setDetail).catch(cause => setError(cause.message)); }}>刷新盘点状态</Button>
      </div>
    </fieldset>}
  </section>;
}
