'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → listing → 销售计划」功能迁移。
 * 源组件：amazon/sales/forecast/index.vue
 * 还原交互：搜索(SKU/MSKU/ASIN)、开始上架日期/结束上架日期 / 重置 / 导出 / 导入 / 批量保存 / 保存 / 详细计划 / 分页。
 * 列：图片、名称/SKU、店铺/国家、本地库存、销量、日均、7天、30天、上架时间、销量预测、三个月份预测列。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/sales-plans）。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/xiaoshou-jihua" fallbackTitle="销售计划" />;
}
