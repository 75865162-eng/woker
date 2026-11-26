'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → listing → 销售报表」功能迁移。
 * 源组件：amazon/sales/report/index.vue
 * 还原交互：搜索(请输入SKU) / 更多条件筛选：销售渠道、配送方式、客户类型、促销订单、折扣金额占原价、订单状态。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/sales），承载核心列与筛选口径。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/xiaoshou-baobiao" fallbackTitle="销售报表" />;
}
