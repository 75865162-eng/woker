'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 本地账目 → 批次成本」功能迁移（新增页，单据型）。
 * 源组件：amazon/payment/jobCosting/index.vue + components/table.vue。
 * 还原交互：店铺/负责人/日期/状态筛选、搜索类型(平台SKU/单据号/货件号)、
 * 12 个表格列（SKU/发货日期/接收日期/状态/单据号/货件号/发出-接收-扣除数量/采购成本/头程成本）、
 * 「修改接收日期」弹窗字段(选择类型 具体日期/增加天数、选择日期、增加天数)、重置成本/导出；
 * 以 document 存储：docNo=单据号、businessDate=发货日期、status=扣减状态，扩展字段存 payload。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/job-costing" fallbackTitle="批次成本" />;
}
