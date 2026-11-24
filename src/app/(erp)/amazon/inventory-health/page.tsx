import { AppShell } from "@/components/app-shell/app-shell";
import { InventoryHealthWorkbench } from "@/components/operations/inventory-health-workbench";

export const metadata = { title: "FBA 库存健康透视 · 亚马逊数据" };

/**
 * /amazon/inventory-health：迁移自 Wimoor FBA 库存 detail + planning。
 * 纯 Amazon FBA Inventory 快照，与赛狐隔离；按站点+SKU 最新快照做健康分层，不推断、不折算。
 */
export default function InventoryHealthPage() {
  return (
    <AppShell title="FBA 库存健康透视" subtitle="可售 / 预留 / 在途 / 不可用 / 调研分列与缺货·滞销信号 · 仅 Amazon FBA 最新快照">
      <InventoryHealthWorkbench />
    </AppShell>
  );
}
