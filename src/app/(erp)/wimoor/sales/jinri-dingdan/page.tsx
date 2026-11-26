'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 今日订单」功能迁移。
 * 源组件：amazon/order/today/index.vue
 * 还原交互：导出 / 分页；表格按「今日 / 昨日 / 上周同日 / 库存」四组对照展示。
 * 列：图片、商品信息、今日(销量QuantityOrdered/净销售额total_price/单价price)、
 * 昨日(QuantityOrdered_yy/totalprice_yy/price_yy)、上周同日(QuantityOrdered_lw/totalprice_lw/price_lw)、
 * 库存(可售fulfillable/待收货inbound/预留reserved)。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /operations/today-orders）。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/jinri-dingdan" fallbackTitle="今日订单" />;
}
