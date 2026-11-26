'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → listing → 商品分析」功能迁移。
 * 源组件：amazon/listing/products/index.vue
 * 还原交互：搜索(全部显示状态/SKU) / 搜索类型(SKU、同级SKU、本地SKU、ASIN、同级ASIN、父ASIN) /
 * 指数过滤 / 添加条件 / 清空条件 / 重置 / 同步商品 / 批量同步FBA库存 / 批量修改负责人 /
 * 批量修改商品价格 / 批量修改销售状态 / 批量同步商品 / 批量下载本地SKU信息 / 确认 / 提交 / 分页。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/listings），承载核心列与筛选口径。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/shangpin-fenxi" fallbackTitle="商品分析" enableMetricFilter />;
}
