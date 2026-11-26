'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → FBA报表 → FBA滞销」功能迁移。
 * 源组件：amazon/inventory/planning/index.vue
 * 还原交互：搜索(SKU/ASIN/订单号) / 重置 / 导出 / 分页；
 * 20 项更多条件：存储体积、商品体积、体积计量单位、仓储类型、健康库存级别、建议操作、售价、建议售价、
 * 建议售价天数、建议移除数量、预估可节约成本、发货中、已发货、接收中、待入库、售罄率、销售排名、
 * 产品分类、11个月滞销数量、11个月费用。
 * 列：库存健康/供货天数/周转(30天、90天)/滞销费用/下月仓储费/季度与月度库龄/销售额/最近发货/冗余库存/库龄附加费。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/inventory-health）。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/fba-zhixiao" fallbackTitle="FBA滞销" />;
}
