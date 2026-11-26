'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 利润报表」口径对照入口。
 * 源组件：amazon/payment/profitReport/index.vue。
 * 等价页已存在：/operations/profit-report，本页为 WIMOOR 口径对照入口。
 * 还原交互：搜索(请输入)/重置、币种(人民币/美元/站点币种)、维度(MSKU/ASIN/父ASIN/SKU/产品名称)筛选、
 * 搜索结果与分页；导出/导出（旧）/重算按钮属于等价页完整实现，本对照页不重复造。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/profit-report" fallbackTitle="利润报表" enableMetricFilter />;
}
