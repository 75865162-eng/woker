'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 平台账目 → FBA仓储费」口径对照入口。
 * 源组件：amazon/report/storage_fee/index.vue（仓储费 / 超龄库存附加费 两个页签）。
 * 等价页已存在：/amazon/storage-fees，本页为 WIMOOR 口径对照入口。
 * 还原交互：费用类型(仓储费/超龄库存附加费)与 SKU/站点筛选、仓储费明细核心列、分页；
 * 完整费用报表与导出保留在等价页。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/storage-fees" fallbackTitle="FBA仓储费" />;
}
