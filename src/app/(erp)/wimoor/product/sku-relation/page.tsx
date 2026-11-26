'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「产品 → 平台配对 → SKU配对」功能迁移。
 * 源组件：amazon/listing/relation_msku/index.vue
 * 还原交互：搜索(ASIN或平台SKU) / 店铺站点筛选 / 重新绑定(本地SKU↔MSKU 配对) / 系统自动绑定MSKU标识 / 组合品标识 / 导入 / 导出下载 / 关闭 / 分页。
 * 说明：以 document 类型单据承载 SKU↔MSKU 配对关系；导入/导出为外部文件操作，通用组件以列表与配对字段承载。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/product/sku-relation" fallbackTitle="SKU配对" />;
}
