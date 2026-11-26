'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「发货 → 发货管理 → FBA发货规划」功能迁移。
 * 源组件：erp/ship/ship_plan/index.vue
 * 还原交互：方案切换(系统默认/运营中心转运/运营中心处理中/正在发货/待接收/正在接收) / 已使用过滤 /
 *          图片 / 名称·SKU / 报表 / 发货需求量 / 实际发货总量 / 可用库存 / 公告 / 操作 / 确定·关闭。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/shipment/ship-plan" fallbackTitle="FBA发货规划" />;
}
