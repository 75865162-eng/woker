import { Download, RefreshCw, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sellfoxSyncDisabledReason } from "@/lib/sellfox/sync-contract";
import { resourceLabels, type Overview, type StoreRow } from "./workbench-types";

export function SellfoxShopFilter({ stores, value, onChange, disabled = false }: { stores: StoreRow[]; value: string[]; onChange: (value: string[]) => void; disabled?: boolean }) {
  return <label className="min-w-0 text-xs text-muted">店铺（未选表示全部）<select multiple value={value} disabled={disabled} onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))} aria-label="店铺筛选" className="mt-1 h-14 w-full min-w-0 border border-border bg-white px-2 text-sm text-foreground">{stores.map((store) => <option key={store.id} value={store.externalId}>{store.name || store.externalId} · {store.marketplace || ""}</option>)}</select></label>;
}
export function SellfoxConnectionBar({ overview, workspaceId, syncResource, setSyncResource, canSync, canExport, working, onSync, onRefresh, exportHref, xlsxHref }: { overview: Overview | null; workspaceId: string; syncResource: string; setSyncResource: (value: string) => void; canSync: boolean; canExport: boolean; working: boolean; onSync: () => void; onRefresh: () => void; exportHref: string; xlsxHref: string }) {
  return <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
    <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand text-white"><Store className="h-5 w-5" /></div><div><div className="flex flex-wrap items-center gap-2"><h1 className="text-base font-bold">赛狐数据工作台</h1><Badge tone={overview?.configured ? "green" : "amber"}>{overview ? overview.configured ? "configured" : "未配置凭据" : "读取中"}</Badge><Badge tone="gray">工作区 {workspaceId}</Badge>{overview?.configured ? <Badge tone={overview.workerOnline ? "green" : "red"}>Worker {overview.workerOnline ? "在线" : "离线"}</Badge> : null}</div><p className="mt-1 text-xs text-muted">报表快照永久保留，可按业务日期查看；不自动清理历史。</p></div></div>
    <div className="flex flex-wrap items-center gap-2"><select aria-label="立即同步资源" value={syncResource} onChange={(event) => setSyncResource(event.target.value)} className="h-9 border border-border bg-white px-2 text-sm">{Object.entries(resourceLabels).map(([resource, label]) => <option key={resource} value={resource} disabled={Boolean(sellfoxSyncDisabledReason(resource))}>{label}{sellfoxSyncDisabledReason(resource) ? "（未接入）" : resource === "hourly" ? "（浅同步）" : ""}</option>)}</select>
      <Button size="sm" onClick={onSync} disabled={!canSync || !overview?.configured || working || Boolean(sellfoxSyncDisabledReason(syncResource))}><RefreshCw className={`h-4 w-4 ${working ? "animate-spin" : ""}`} />立即同步</Button><Button size="sm" variant="secondary" onClick={onRefresh}><RefreshCw className="h-4 w-4" />刷新</Button>
      {canExport && exportHref ? <a className="inline-flex h-9 items-center gap-2 border border-border px-3 text-sm font-medium hover:bg-surface-muted" href={exportHref}><Download className="h-4 w-4" />CSV</a> : null}{canExport && xlsxHref ? <a className="inline-flex h-9 items-center border border-border px-3 text-sm" href={xlsxHref}>Excel</a> : null}
    </div>
  </header>;
}
