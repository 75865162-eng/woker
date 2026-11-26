'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → listing → 促销报告」功能迁移。
 * 源组件：amazon/report/performance/index.vue
 * 说明：源页面仅 29 行、无筛选项/表格列/按钮，本项目已有功能完整的促销报告页。
 * 等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/promotions），仅承载报告基础字段。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/cuxiao-baogao" fallbackTitle="促销报告" />;
}
