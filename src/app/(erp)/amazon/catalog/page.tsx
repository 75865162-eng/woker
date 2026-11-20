import "../../sellfox/sellfox-ui.css";
import { AppShell } from "@/components/app-shell/app-shell";
import { AmazonCatalogWorkbench } from "@/components/amazon/catalog-workbench";

export const metadata = { title: "在线商品与库存 · 亚马逊数据" };

/**
 * /amazon/catalog：参考赛狐 /sellfox/dimensions 分组下钻范式重写的「在线商品与库存」页。
 * 真实 page 优先于 amazonSlugRoutes 的 view:catalog rewrite，因此表格由本页工作台渲染。
 * 骨架为 SKU 级在线商品快照，库存按 SKU 关联 FBA 库存快照，销量为订单口径累计件数，口径在页面内显式标注。
 */
export default function AmazonCatalogPage() {
  return (
    <AppShell title="在线商品与库存" subtitle="站点 / 店铺两级分组，点店铺查看该店铺已发布的在线商品 SKU 明细（标题/主图/刊登状态/关联库存）；销量为订单口径累计件数，非按日快照。">
      <AmazonCatalogWorkbench />
    </AppShell>
  );
}
