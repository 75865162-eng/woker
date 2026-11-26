'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → listing → 销量详情」功能迁移。
 * 源组件：amazon/sales/details/index.vue
 * 还原交互：搜索(请输入SKU) / 汇总维度(按日汇总、按周汇总、按月汇总) / 指标(销量、订单) / 导出 / 分页。
 * 列：图片(img)、名称/MSKU(sku)、上架日期(openDate)、汇总(vsum)。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/order-detail）。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/xiaoliang-xiangqing" fallbackTitle="销量详情" />;
}
