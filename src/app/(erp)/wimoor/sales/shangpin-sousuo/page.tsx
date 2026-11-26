'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「销售 → listing → 商品搜索」功能迁移（新增页）。
 * 源组件：amazon/listing/catalog/index.vue
 * 还原交互：搜索(关键词，用;分割) / 站点语言(站点语言、英文en_US、中文zh_CN) / 搜索 / 导出 /
 * 上一页 / 下一页(工作台分页) / 总计条数 / 在结果中查找(品牌、分类多选) / 清除 / 确认。
 * 列：主图、ASIN、商品名称/品牌/分类、排名(分类排名与分组排名)、排名链接。
 * 说明：源页面为卡片视图，通用工作台以表格列承载同一批字段口径。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/sales/shangpin-sousuo" fallbackTitle="商品搜索" />;
}
