'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → 评论&绩效 → 差评管理」功能迁移。
 * 源组件：amazon/report/performance/orderfeedback/index.vue
 * 还原列口径：站点(marketname)、订单(amazon_order_id)、购买时间(purchase_date)、评论时间(feeddate)、
 * 产品(sku)、评星(rating)、评论(comments)、回复(response)、邮箱(email)。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /operations/reviews）。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/chapin-guanli" fallbackTitle="差评管理" />;
}
