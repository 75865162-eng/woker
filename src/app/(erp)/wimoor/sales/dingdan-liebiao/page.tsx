'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 订单列表」功能迁移。
 * 源组件：amazon/order/order_manager/index.vue
 * 说明：源页面仅 15 行（空壳组件），本项目已有完整订单管理页。
 * 等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/orders），承载订单基础字段口径。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/dingdan-liebiao" fallbackTitle="订单列表" enableMetricFilter />;
}
