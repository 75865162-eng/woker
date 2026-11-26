'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 账期未结算」功能迁移（新增页）。
 * 源组件：amazon/report/open/index.vue。
 * 还原交互：店铺/日期筛选、搜索「ASIN或平台SKU」（源 Vue 中该输入框被注释，本页保留搜索能力）、
 * 7 个表格列按源 Vue 全量还原（平台商品信息含名称/SKU/ASIN/站点，费用时间含订单号，
 * 费用类型含 ftypename 子行）、导出；数据由用户显式补录。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/open" fallbackTitle="账期未结算" />;
}
