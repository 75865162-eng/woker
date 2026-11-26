'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 业绩报告」口径对照入口。
 * 源组件：amazon/payment/performanpce/index.vue。
 * 等价页已存在：/sellfox/performance，本页为 WIMOOR 口径对照入口。
 * 还原交互：搜索(请输入)/重置、币种(人民币/美元/站点币种)、维度(MSKU/ASIN/父ASIN/SKU/产品名称)筛选、
 * 业绩核心列与分页；导出交互保留在等价页。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/performance" fallbackTitle="业绩报告" enableMetricFilter />;
}
