import { ArrowRight, CircleCheck, CircleDashed, ShieldCheck } from "lucide-react";
import { AmazonMcpPanel } from "@/components/operations/amazon-mcp-panel";
import { Badge } from "@/components/ui/badge";

const plannedInterfaces = [
  ["ads_get_*", "广告结构、已发布日报、趋势/贡献度查询", "结构与日报只读已接入；趋势/贡献度待具体报告合同核验"],
  ["ads_execute_apply / ads_execute_changes", "2 个广告变更接口", "转为草稿，复用现有审批"],
  ["listing_execute_change", "刊登变更接口", "转为刊登变更草稿"],
  ["restock_*", "5 个补货执行接口", "转为补货操作草稿"],
  ["market_get_asin_keyword_signals", "ASIN 关键词信号", "有已验证来源才启用"],
  ["meta_get_market_access", "市场访问范围", "仅返回系统已验证授权范围"],
] as const;

export function SkillErpSettingsPanel() {
  return (
    <div className="space-y-5">
      <section className="border-b border-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Skill 接入 ERP</h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-muted">
              Skill 通过当前系统的 Amazon MCP 读取已发布数据。首批范围从当前用户可访问的数据源产生；工具调用仍受系统店铺授权和凭证范围共同约束。
            </p>
          </div>
          <a href="/operations?view=connections" className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground">
            店铺与授权 <ArrowRight className="h-4 w-4" />
          </a>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="green"><CircleCheck className="mr-1 h-3 w-3" />MCP 工具已实现</Badge>
          <Badge tone="gray"><CircleDashed className="mr-1 h-3 w-3" />字段映射待核实</Badge>
          <Badge tone="gray"><ShieldCheck className="mr-1 h-3 w-3" />沿用现有店铺授权</Badge>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">未暴露接口处理</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-left text-xs">
            <thead><tr className="border-b border-border text-muted"><th className="py-2 pr-4 font-medium">接口</th><th className="py-2 pr-4 font-medium">用途</th><th className="py-2 font-medium">接入策略</th></tr></thead>
            <tbody>{plannedInterfaces.map(([name, use, status]) => <tr key={name} className="border-b border-border/70"><td className="py-2 pr-4 font-mono">{name}</td><td className="py-2 pr-4">{use}</td><td className="py-2">{status}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-semibold">Skill MCP 凭证</h3>
        <AmazonMcpPanel />
      </section>
    </div>
  );
}
