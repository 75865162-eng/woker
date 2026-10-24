import { CheckCircle2, Clock3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { sellfoxSyncDisabledReason } from "@/lib/sellfox/sync-contract";
import { dateTime, display, resourceLabels, type Overview, type Run } from "./workbench-types";

export function SellfoxRecentRuns({ runs, onAll }: { runs: Run[]; onAll: () => void }) {
  return <section className="border border-border bg-white"><div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">最近同步</h2><button className="text-xs font-semibold text-brand" onClick={onAll}>全部日志</button></div><div className="divide-y divide-border">{runs.slice(0, 6).map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><span className="font-medium">{resourceLabels[run.resource] ?? run.resource}</span><span className="text-xs text-muted">{dateTime(run.startedAt)}</span><Badge tone={run.status === "done" ? "green" : run.status === "failed" ? "red" : "amber"}>{display(run.status, "status")}</Badge>{run.error ? <span className="basis-full text-xs text-red-700">{run.error}</span> : null}</div>)}{runs.length === 0 ? <p className="px-4 py-8 text-center text-sm text-muted">暂无同步记录。</p> : null}</div></section>;
}
export function SellfoxSyncRunsPanel({ overview }: { overview: Overview | null }) {
  return <section className="border border-border bg-white"><div className="flex items-center gap-2 border-b border-border px-3 py-2.5"><Clock3 className="h-4 w-4 text-muted" /><h2 className="text-xs font-semibold">资源健康度</h2></div><div className="divide-y divide-border">{Object.entries(resourceLabels).map(([resource, label]) => {
    const latest = overview?.latestSuccessByResource?.[resource]; const recent = overview?.latestRuns.find((run) => run.resource === resource);
    const disabledReason = sellfoxSyncDisabledReason(resource);
    return <div key={resource} className="px-3 py-2.5"><div className="flex items-center justify-between text-xs"><span>{label}</span>{disabledReason ? <span className="text-muted">未接入</span> : recent?.status === "failed" ? <span className="text-red-700">最近失败</span> : recent?.status === "running" || recent?.status === "queued" ? <span className="text-amber-700">{display(recent.status, "status")}</span> : latest ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <span className="text-muted">未同步</span>}</div><p className="mt-1 text-[11px] text-muted">最近成功：{latest ? dateTime(latest.finishedAt || latest.startedAt) : "暂无"}</p>{recent?.status === "failed" && recent.error ? <p className="mt-1 line-clamp-2 text-[10px] text-red-700">{recent.error}</p> : null}{disabledReason ? <p className="mt-1 text-[10px] text-muted">{disabledReason}</p> : null}</div>;
  })}</div></section>;
}
