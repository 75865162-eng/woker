'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → 评论&绩效 → 店铺绩效」功能迁移。
 * 源组件：amazon/report/performance/seller/index.vue
 * 还原交互：筛选(目标、订单总数) / 分页。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/reviews），承载绩效指标目标/实际口径。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/dianpu-jixiao" fallbackTitle="店铺绩效" />;
}
