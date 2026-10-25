import { useEffect, useId, useRef, useState } from "react";
import { Download, RefreshCw, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sellfoxSyncDisabledReason } from "@/lib/sellfox/sync-contract";
import { resourceLabels, type Overview, type StoreRow } from "./workbench-types";

export function SellfoxShopFilter({ stores, value, onChange, disabled = false }: { stores: StoreRow[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent | FocusEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("focusin", closeOutside);
    return () => {
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("focusin", closeOutside);
    };
  }, [open]);
  const selected = stores.filter(store => value.includes(store.externalId));
  const matches = stores.filter(store => `${store.name} ${store.externalId} ${store.marketplace}`.toLowerCase().includes(search.toLowerCase()));
  // A label click can blur the trigger with no relatedTarget on macOS. Keep the
  // panel visible until a real outside pointer/focus event, so label activation completes.
  return <div ref={containerRef} className="relative w-32 shrink-0 text-[11px] text-muted" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); triggerRef.current?.focus(); } }}><span>店铺（可多选）</span><div className="mt-1"><button ref={triggerRef} type="button" aria-label="展开店铺筛选" aria-expanded={open && !disabled} aria-controls={panelId} disabled={disabled} onClick={() => setOpen(value => !value)} className="flex h-7 w-full cursor-pointer items-center justify-between border border-border bg-white px-2 text-xs text-foreground disabled:pointer-events-none disabled:opacity-50"><span className="truncate">{selected.length === 1 ? selected[0].name || selected[0].externalId : selected.length ? `已选 ${selected.length} 家店铺` : "全部店铺"}</span><span aria-hidden="true">⌄</span></button><div id={panelId} hidden={!open || disabled} className="absolute left-0 z-40 mt-1 w-64 max-w-[calc(100vw-2rem)] border border-border bg-white p-2 shadow-lg">
    <input aria-label="搜索店铺" placeholder="搜索店铺 / 站点" value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} className="h-8 w-full border border-border px-2 text-xs" />
    <div className="flex gap-3 py-2"><button disabled={disabled} onClick={() => onChange([...new Set([...value, ...matches.map(store => store.externalId)])])} className="text-brand">全选{search ? "搜索结果" : ""}</button><button disabled={disabled} onClick={() => onChange([])} className="text-brand">清空店铺选择</button></div>
    <div aria-label="店铺筛选" className="max-h-56 overflow-auto">{matches.map(store => <label key={store.id} className="flex items-center gap-2 py-1.5"><input type="checkbox" disabled={disabled} checked={value.includes(store.externalId)} onChange={event => onChange(event.target.checked ? [...value, store.externalId] : value.filter(id => id !== store.externalId))} />{store.name || store.externalId} · {store.marketplace || ""}</label>)}{matches.length === 0 ? <p className="py-3">无匹配店铺</p> : null}</div><p className="mt-2">未选表示全部店铺</p>
  </div></div></div>;
}

export function SellfoxConnectionBar({ overview, workspaceId, syncResource, setSyncResource, canSync, canExport, working, onSync, onRefresh, exportHref, xlsxHref }: { overview: Overview | null; workspaceId: string; syncResource: string; setSyncResource: (value: string) => void; canSync: boolean; canExport: boolean; working: boolean; onSync: () => void; onRefresh: () => void; exportHref: string; xlsxHref: string }) {
  return <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-2">
    <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-white"><Store className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-base font-bold">赛狐数据工作台</h1><Badge tone={overview?.configured ? "green" : "amber"}>{overview ? overview.configured ? "configured" : "未配置凭据" : "读取中"}</Badge><Badge tone="gray">工作区 {workspaceId}</Badge>{overview?.configured ? <Badge tone={overview.workerOnline ? "green" : "red"}>Worker {overview.workerOnline ? "在线" : "离线"}</Badge> : null}</div><p className="mt-1 text-xs text-muted">报表快照永久保留，可按业务日期查看；不自动清理历史。</p></div></div>
    <div className="flex flex-wrap items-center gap-2"><select aria-label="立即同步资源" value={syncResource} onChange={(event) => setSyncResource(event.target.value)} className="h-9 border border-border bg-white px-2 text-sm">{Object.entries(resourceLabels).map(([resource, label]) => <option key={resource} value={resource} disabled={Boolean(sellfoxSyncDisabledReason(resource))}>{label}{sellfoxSyncDisabledReason(resource) ? "（未接入）" : resource === "hourly" ? "（浅同步）" : ""}</option>)}</select>
      <Button size="sm" onClick={onSync} disabled={!canSync || !overview?.configured || working || Boolean(sellfoxSyncDisabledReason(syncResource))}><RefreshCw className={`h-4 w-4 ${working ? "animate-spin" : ""}`} />立即同步</Button><Button size="sm" variant="secondary" onClick={onRefresh}><RefreshCw className="h-4 w-4" />刷新</Button>
      {canExport && exportHref ? <a className="inline-flex h-9 items-center gap-2 border border-border px-3 text-sm font-medium hover:bg-surface-muted" href={exportHref}><Download className="h-4 w-4" />CSV</a> : null}{canExport && xlsxHref ? <a className="inline-flex h-9 items-center border border-border px-3 text-sm" href={xlsxHref}>Excel</a> : null}
    </div>
  </header>;
}
