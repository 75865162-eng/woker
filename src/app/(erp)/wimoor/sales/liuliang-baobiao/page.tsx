'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → FBA报表 → 流量报表」功能迁移（新增页）。
 * 源组件：amazon/report/pageview/index.vue
 * 还原交互：店铺选择 / 日期筛选 / 搜索(请输入SKU) / 分页。
 * 列：图片(image)、SKU(名称+SKU)、日期(byday)、访问次数(sessions)、访问转化率(sessionPercentage%)、
 * 浏览次数(pageViews)、浏览转化率(pageViewsPercentage%)、购物车比例(buyBoxPercentage%)、
 * 销量(unitsOrdered + B2B)、商品转化率(unitSessionPercentage% + B2B)、
 * 销售额(orderedProductSales + B2B)、订单(totalOrderItems + B2B)。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/liuliang-baobiao" fallbackTitle="流量报表" />;
}
