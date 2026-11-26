'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 退货订单」功能迁移。
 * 源组件：amazon/order/refund/index.vue
 * 说明：源页面仅 58 行、无可提取筛选项/列/按钮，本项目已有完整退货管理页。
 * 等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/returns），承载退货单基础字段口径。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/tuihuo-dingdan" fallbackTitle="退货订单" />;
}
