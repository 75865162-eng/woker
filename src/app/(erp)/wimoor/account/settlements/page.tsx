'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 结算记录」口径对照入口。
 * 源组件：amazon/payment/record/index.vue（账期 / 汇总 / 图表 三个页签）。
 * 等价页已存在：/amazon/settlements，本页为 WIMOOR 口径对照入口。
 * 还原交互：账期/店铺搜索、币种/状态筛选、账期与汇总核心列、分页、显式新增结算记录；
 * 汇总图表与导出交互保留在等价页。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/settlements" fallbackTitle="结算记录" />;
}
