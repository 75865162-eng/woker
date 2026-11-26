'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「发货 → 发货管理 → 货件跟踪」功能迁移。
 * 源组件：erp/ship/shipment_handing/list/index.vue（Header + Table）
 * 还原交互：状态页签(全部货件/处理中/已发货/正在接收/已完成/已取消/异常单据) /
 *          店铺·国家·仓库·日期 / 承运商·物流渠道·运输方式 / 货件号搜索 / 箱规·参考号筛选 /
 *          货件号、店铺、国家、仓库、承运商、渠道、运输方式、跟踪状态列表及状态流转。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/shipment/track" fallbackTitle="货件跟踪" enableMetricFilter />;
}
