'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 本地账目 → 库存货值」功能迁移（新增页）。
 * 源组件：erp/finance/inventoryValue/index.vue + components/self.vue（本地仓）+ components/fba.vue（FBA仓）。
 * 还原交互：本地仓/FBA仓切换（以 warehouseType 字段承载）、仓库/店铺筛选、库存日期、SKU 搜索、
 * 「使用采购加权平均成本」勾选项、导出；表格列按两个页签全量还原
 * （名称/SKU、现有/可用/预留/待入库/总库存、采购单价、总货值、在途货值、采购待付款、其它成本、头程运费、备注）。
 * 金额不臆造汇率，均由用户显式补录。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.inventoryValue',
  title: '库存货值',
  subtitle: 'WIMOOR 库存货值迁移：本地仓与 FBA 仓口径、库存日期、加权平均成本开关与货值/成本列完整交互。',
  addLabel: '新增库存货值记录',
  searchPlaceholder: '请输入本地SKU/平台SKU',
  columns: [
    { key: 'warehouseType', label: '仓库类型', width: 100 },
    { key: 'sku', label: '名称/SKU', width: 200 },
    { key: 'quantity', label: '现有库存', width: 110, numeric: true },
    { key: 'fulfillable', label: '可用库存', width: 110, numeric: true },
    { key: 'reserved', label: '预留库存', width: 110, numeric: true },
    { key: 'inbound', label: '待入库库存', width: 120, numeric: true },
    { key: 'totalQuantity', label: '总库存(可用)', width: 120, numeric: true },
    { key: 'price', label: '采购成本单价(￥)', width: 140, numeric: true },
    { key: 'totalprice', label: '总货值(￥)', width: 120, numeric: true },
    { key: 'inpasscost', label: '在途货值(￥)', width: 120, numeric: true },
    { key: 'inpasspay', label: '采购待付款(￥)', width: 140, numeric: true },
    { key: 'otherFeer', label: '其它成本(￥)', width: 120, numeric: true },
    { key: 'firstLegCharges', label: '头程运费(￥)', width: 130, numeric: true },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'warehouseType', label: '仓库类型', required: true, kind: 'select', defaultValue: '本地仓',
      options: [{ value: '本地仓', label: '本地仓' }, { value: 'FBA仓', label: 'FBA仓' }] },
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入本地SKU/平台SKU' },
    { key: 'name', label: '名称', placeholder: '请输入产品名称' },
    { key: 'byday', label: '库存日期', kind: 'date' },
    { key: 'quantity', label: '现有库存', kind: 'number' },
    { key: 'fulfillable', label: '可用库存', kind: 'number' },
    { key: 'reserved', label: '预留库存', kind: 'number' },
    { key: 'inbound', label: '待入库库存', kind: 'number' },
    { key: 'totalQuantity', label: '总库存(可用)', kind: 'number' },
    { key: 'price', label: '采购成本单价(￥)', kind: 'number' },
    { key: 'totalprice', label: '总货值(￥)', kind: 'number' },
    { key: 'inpasscost', label: '在途货值(￥)', kind: 'number' },
    { key: 'inpasspay', label: '采购待付款(￥)', kind: 'number' },
    { key: 'otherFeer', label: '其它成本(￥)', kind: 'number' },
    { key: 'firstLegCharges', label: '头程运费(￥)', kind: 'number' },
    { key: 'isAvgPrice', label: '使用采购加权平均成本', kind: 'select', defaultValue: '否',
      options: [{ value: '是', label: '是' }, { value: '否', label: '否' }] },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'warehouseType', label: '仓库类型', kind: 'select',
      options: [{ value: '本地仓', label: '本地仓' }, { value: 'FBA仓', label: 'FBA仓' }] },
    { key: 'byday', label: '库存日期', kind: 'date' },
    { key: 'isAvgPrice', label: '使用采购加权平均成本', kind: 'select',
      options: [{ value: '是', label: '是' }, { value: '否', label: '否' }] },
    { key: 'warehouse', label: '仓库/店铺', placeholder: '请输入仓库或店铺' },
  ],
};

export default function WimoorAccountInventoryValuePage() {
  return <MasterDataWorkbench config={config} />;
}
