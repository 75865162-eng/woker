'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 移除订单」功能迁移。
 * 源组件：amazon/order/remove/index.vue
 * 说明：源页面仅 25 行（空壳组件），本项目已有完整移除订单报告页。
 * 等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/removal-order-report）。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/yichu-dingdan" fallbackTitle="移除订单" />;
}
