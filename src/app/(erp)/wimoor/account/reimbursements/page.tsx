'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 赔偿费用」功能迁移（新增页）。
 * 源组件：amazon/report/reimbursements_fee/index.vue。
 * 还原交互：店铺/日期筛选、搜索「ASIN或平台SKU」、导出；9 个表格列按源 Vue 全量还原
 * （平台商品信息含图片/名称/SKU/ASIN，费用时间含订单号，报销原因含报销号）；
 * 用户显式补录才有数据，框架不预置伪造数据，导出交互沿用等价报表口径。
 */

/**
 * 本页已从原「口径对照入口（主数据空表）」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/reimbursements" fallbackTitle="赔偿费用" />;
}
