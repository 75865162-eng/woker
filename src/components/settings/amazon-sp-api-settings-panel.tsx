import { ArrowRight, ShieldCheck } from "lucide-react";

export function AmazonSpApiSettingsPanel() {
  return <section id="amazon-sp-api" className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4">
    <div><h2 className="text-sm font-semibold">Amazon 数据处理中心</h2><p className="mt-1 text-xs text-muted">Amazon SP-API 配置：进入“店铺与授权”→“新增授权”，填写 LWA Client ID、Client Secret 和 Refresh Token。配置变更通过审批流程管理。</p></div>
    <a href="/operations?view=connections" className="inline-flex h-8 items-center gap-2 rounded-md bg-brand px-3 text-xs font-semibold text-white"><ShieldCheck className="h-4 w-4" />打开数据处理中心<ArrowRight className="h-4 w-4" /></a>
  </section>;
}
