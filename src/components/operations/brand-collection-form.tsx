"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { brandReports, brandPeriodLabels } from "@/lib/amazon-sync/brand-reports";
import { parseBrandCollection, brandCollectionWindows, type BrandCollection } from "@/lib/amazon-sync/brand-collection";
import type { BrandConfiguration } from "./brand-analytics-workbench";
const input = "min-h-9 w-full rounded border border-border bg-background px-2 text-xs";
export function BrandCollectionForm({ configuration, plans, getHeaders, onCommand, busy }: { configuration: BrandConfiguration; plans: Array<{ id: string; enabled: boolean }>; getHeaders: () => Headers; onCommand: (command: Record<string, unknown>) => Promise<boolean>; busy: boolean }) {
  const current = configuration.domainPolicy.collection as BrandCollection | undefined;
  const [from, setFrom] = useState(current?.from ?? ""), [to, setTo] = useState(current?.to ?? ""), [asins, setAsins] = useState(current?.asins.join("\n") ?? ""), [selected, setSelected] = useState(current?.selections.map(s => `${s.reportKind}:${s.reportPeriod}`) ?? Object.keys(brandReports).map(k => `${k}:WEEK`)), [maxTasks, setMaxTasks] = useState(current?.maxTasks ?? 2000), [error, setError] = useState(""), [discovery, setDiscovery] = useState(""), [finding, setFinding] = useState(false);
  let preview = ""; let collection: BrandCollection | null = null;
  try { collection = parseBrandCollection({ from, to, asins: asins.split(/[,\s]+/).filter(Boolean), selections: selected.map(s => { const [reportKind, reportPeriod] = s.split(":"); return { reportKind, reportPeriod }; }), maxTasks }); const windows = brandCollectionWindows(collection); preview = `${windows.length} 份报告；每份最多 ${configuration.domainPolicy.maxRequests} 次请求、${configuration.domainPolicy.maxRows} 行；整个清单请求预算上限 ${windows.length * Number(configuration.domainPolicy.maxRequests)} 次。报告生成耗时与轮询会影响实际用量。`; } catch (e) { preview = e instanceof Error ? e.message : "请完善清单。"; }
  const discover = async () => {
    setFinding(true); setError("");
    try { const response = await fetch(`/api/operations/sync-center?${new URLSearchParams({ section: "brand-asins", sourceId: configuration.id })}`, { headers: getHeaders(), cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "商品清单读取失败。"); setAsins(data.manifest.ids.join("\n")); setDiscovery(`${data.manifest.total} 个 ASIN；来源快照 ${data.manifest.runId}。${data.note}`); }
    catch (e) { setError(e instanceof Error ? e.message : "读取失败。"); }
    finally { setFinding(false); }
  };
  return <section className="space-y-3 rounded border border-border p-3"><h3 className="text-sm font-semibold">多报告历史回补清单</h3><p className="text-xs text-muted">先生成清单并申请配置审批。清单批准后，可申请单份任务，或另行申请启用后台回补计划。日期范围固定，完成后不会自动扩展到未来周期。</p>
    <form className="space-y-3" onSubmit={e => { e.preventDefault(); setError(""); if (!collection) { setError("请核对有效清单。"); return; } void onCommand({ action: "save-source", id: configuration.id, revision: configuration.revision, authorizationId: configuration.authorizationId, sellerAccountId: configuration.sellerAccountId, marketplaceId: configuration.marketplaceId, resource: "brand_analytics", enabled: configuration.enabled, freshnessMinutes: configuration.freshnessMinutes, domainPolicy: { ...configuration.domainPolicy, collection, brandEligibilityAttested: true } }); }}>
      <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-xs">回补范围开始<input className={input} type="date" required value={from} onChange={e => { setFrom(e.target.value); }} /></label><label className="grid gap-1 text-xs">回补范围结束<input className={input} type="date" required value={to} onChange={e => { setTo(e.target.value); }} /></label><label className="grid gap-1 text-xs">批准报告份数上限<input className={input} type="number" min={1} max={2000} value={maxTasks} onChange={e => { setMaxTasks(Number(e.target.value)); }} /></label></div>
      <fieldset className="grid gap-3 sm:grid-cols-2"><legend className="mb-2 text-xs">报告类型与周期（分别采集）</legend>{Object.entries(brandReports).map(([kind, report]) => <div key={kind} className="space-y-2 rounded border border-border p-2"><p className="text-xs font-medium">{report.label}</p><div className="flex flex-wrap gap-3">{report.periods.map(period => { const key = `${kind}:${period}`; return <label key={key} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={selected.includes(key)} onChange={e => { setSelected(old => e.target.checked ? [...old, key] : old.filter(k => k !== key)); }} />{brandPeriodLabels[period]}</label>; })}</div></div>)}</fieldset>
      <label className="grid gap-1 text-xs">SQP / SCP 候选 ASIN（最多 1,000 个，按 18 个拆批）<textarea className={`${input} min-h-24 font-mono`} value={asins} onChange={e => { setAsins(e.target.value); setDiscovery(""); }} /></label>
      <Button type="button" size="sm" variant="secondary" disabled={finding || busy} onClick={() => void discover()}>从完整商品快照载入 ASIN</Button>{discovery && <p className="text-xs text-muted">{discovery}</p>}
      <p className="text-xs text-muted">{preview}</p><p className="text-xs text-muted">日期边缘不足完整周期不外扩、不采集；早期历史能否返回由 Amazon 决定。商品清单只证明对象来源，不能代替品牌资格。所有报告的官方保留期未统一，不默认承诺 730 天。</p>
      <p className="text-xs text-muted">访问权限统一在账号设置管理；Amazon 根据实际授权与品牌资格返回报告。</p>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}<Button size="sm" type="submit" disabled={busy || !collection}>申请保存回补清单</Button>
    </form>
    {current && !plans.length && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void onCommand({ action: "save-plan", name: "品牌分析 · 已批准范围历史回补", resource: "brand_analytics", enabled: true, mode: "snapshot", intervalMinutes: 1440, priority: 4, maxAttempts: 3, retentionDays: 3650, sourceIds: [configuration.id] })}>申请启用后台回补计划</Button>}
    {!!plans.length && <p className="text-xs text-muted">已有后台计划：{plans.map(p => `${p.id}（${p.enabled ? "启用" : "暂停"}）`).join("、")}。在“同步计划”审批暂停或恢复；失败任务从原检查点恢复。</p>}
  </section>;
}
