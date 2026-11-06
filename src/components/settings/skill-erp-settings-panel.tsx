import { ArrowRight } from "lucide-react";
import { AmazonMcpPanel } from "@/components/operations/amazon-mcp-panel";

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
      </section>

      <section className="border-t border-border pt-4">
        <h3 className="mb-3 text-sm font-semibold">Skill MCP 凭证</h3>
        <AmazonMcpPanel />
      </section>
    </div>
  );
}
