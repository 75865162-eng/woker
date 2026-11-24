import { AppShell } from "@/components/app-shell/app-shell";
import { ReplenishmentSignalsWorkbench } from "@/components/operations/replenishment-signals-workbench";

export const metadata = { title: "补货信号与覆盖周数 · 亚马逊数据" };

/**
 * /amazon/replenishment-signals：迁移自 Wimoor AmzInventoryPlanningController。
 * 纯 Amazon FBA 库存快照 + 商品日销量，与赛狐隔离；覆盖周数/断货·滞销信号，不伪造补货建议字段。
 */
export default function ReplenishmentSignalsPage() {
  return (
    <AppShell title="补货信号与覆盖周数" subtitle="可售 / 在途 + 近30天日均 → 覆盖天数·周数 · 断货/滞销/90天无销量信号 · 仅提示非结论">
      <ReplenishmentSignalsWorkbench />
    </AppShell>
  );
}
