'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 账期SKU」口径对照入口。
 * 源组件：amazon/payment/settlement_sku/index.vue（SKU详情 / 账期SKU 两个页签）。
 * 等价页已存在：/operations/settlement-sku-pivot，本页为 WIMOOR 口径对照入口。
 * 还原交互：SKU/ASIN 搜索、账期/站点/币种筛选、账期 SKU 明细核心列、分页；
 * SKU 详情透视图表保留在等价页。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/settlement-sku" fallbackTitle="账期SKU" />;
}
