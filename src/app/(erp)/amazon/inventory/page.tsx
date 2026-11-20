import "../../sellfox/sellfox-ui.css";
import { AppShell } from "@/components/app-shell/app-shell";
import { AmazonInventoryWorkbench } from "@/components/amazon/inventory-workbench";

export const metadata = { title: "FBA 库存 · 亚马逊数据" };

/**
 * /amazon/inventory：参考赛狐 /sellfox/dimensions 分组下钻范式重写的 FBA 库存页。
 * 真实 page 优先于 amazonSlugRoutes 的 view:inventory rewrite，因此表格由本页工作台渲染。
 * 销量为订单口径累计件数，不冒充按日快照；口径说明在页面内显式标注。
 */
export default function AmazonInventoryPage() {
  return (
    <AppShell title="FBA 库存" subtitle="站点 / 店铺两级分组，点店铺查看该店铺已发布库存的 ASIN 明细；销量为订单口径累计件数，非按日快照。">
      <AmazonInventoryWorkbench />
    </AppShell>
  );
}
