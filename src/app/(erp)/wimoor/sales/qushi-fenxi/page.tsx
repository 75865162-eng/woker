'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → listing → 趋势分析」功能迁移（新增页）。
 * 源组件：amazon/listing/analysis/index.vue + components/data_deatils.vue
 * 还原交互：搜索类型(平台SKU、ASIN、本地SKU、商品名称、子SKU、子ASIN、父ASIN) / 关键词(请输入) /
 * 店铺站点切换 / SKU列表选中 / 详情(图片、名称、SKU、ASIN、首次上架日期、备注、跳转亚马逊) /
 * 页签(销量、历史排名) / 时间范围(近7天、近30天、近90天) / 日期筛选 / 19 项趋势指标 / 指标明细表 / 分页。
 * 说明：右侧 ECharts 图表与明细表在通用工作台中以「指标 + 时间范围 + 明细字段」口径承载。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/qushi-fenxi" fallbackTitle="趋势分析" />;
}
