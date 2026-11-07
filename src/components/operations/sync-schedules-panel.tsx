"use client";
import { Button } from "@/components/ui/button";
export function SyncSchedulesPanel() {
  return <section className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4">
    <div><h3 className="text-sm font-semibold">Amazon 同步计划已归并</h3><p className="mt-1 text-xs text-muted">Seller 范围、频率和执行请求统一在数据处理中心提交审批。</p></div>
    <Button size="sm" onClick={() => window.location.assign("/operations?view=plans")}>打开 Amazon 数据处理中心</Button>
  </section>;
}
