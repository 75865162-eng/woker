'use client';
import { AmazonDatasetWorkbench } from '@/components/wimoor-migration/amazon-dataset-workbench';

/**
 * WIMOOR「账目 → 本地账目 → 库存货值」功能迁移（新增页）。
 * 源组件：erp/finance/inventoryValue/index.vue + components/self.vue（本地仓）+ components/fba.vue（FBA仓）。
 * 还原交互：本地仓/FBA仓切换（以 warehouseType 字段承载）、仓库/店铺筛选、库存日期、SKU 搜索、
 * 「使用采购加权平均成本」勾选项、导出；表格列按两个页签全量还原
 * （名称/SKU、现有/可用/预留/待入库/总库存、采购单价、总货值、在途货值、采购待付款、其它成本、头程运费、备注）。
 * 金额不臆造汇率，均由用户显式补录。
 */

/**
 * 本页已从原「主数据口径对照入口」升级为亚马逊真实数据只读页。
 * 映射定义见 src/lib/wimoor-migration/page-dataset-map.ts（按 localHref 索引）。
 */
export default function WimoorAmazonPage() {
  return <AmazonDatasetWorkbench pageKey="/wimoor/account/inventory-value" fallbackTitle="库存货值" />;
}
