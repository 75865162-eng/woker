import { ArrowRight, CircleCheck, CircleDashed, ShieldCheck } from "lucide-react";
import { AmazonMcpPanel } from "@/components/operations/amazon-mcp-panel";
import { Badge } from "@/components/ui/badge";

const availableTools = [
  ["amazon.stores.list", "授权店铺和站点"],
  ["amazon.inventory.list", "已发布库存快照"],
  ["amazon.inventory.summary", "授权库存汇总"],
  ["amazon.catalog.list", "已发布刊登快照"],
  ["amazon.sales.list", "店铺逐日销售流量"],
  ["amazon.sync.status", "数据源同步状态"],
  ["amazon.history.read", "成功的库存或刊登历史快照"],
  ["amazon.sales.export", "有界销售数据 JSONL 导出"],
  ["data_list_tables", "当前授权范围内已发布逻辑表目录"],
  ["data_describe_table", "逻辑表字段、粒度和数据限制"],
  ["data_query", "分页查询库存、刊登和店铺日销售流量"],
  ["data_sync_status", "同步来源状态"],
  ["data_sync_start", "提交待审批同步申请，不直接启动任务"],
] as const;

const plannedInterfaces = [
  ["ads_get_*", "7 个广告结构/趋势/贡献度读取接口", "待核对现有 Ads 数据粒度"],
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
              Skill 通过当前系统的 Amazon MCP 读取已发布数据。首批范围从当前用户可访问且已验证的数据源产生；工具调用仍受系统店铺授权和凭证范围共同约束。
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
        <h3 className="text-sm font-semibold">当前可用的 MCP 工具</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-xs">
            <thead><tr className="border-b border-border text-muted"><th className="py-2 pr-4 font-medium">工具</th><th className="py-2 font-medium">数据</th></tr></thead>
            <tbody>{availableTools.map(([tool, description]) => <tr key={tool} className="border-b border-border/70"><td className="py-2 pr-4 font-mono">{tool}</td><td className="py-2">{description}</td></tr>)}</tbody>
          </table>
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
