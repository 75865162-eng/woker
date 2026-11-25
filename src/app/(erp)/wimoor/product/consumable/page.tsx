'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 辅料包材 → 辅料管理」功能迁移。
 * 源组件：erp/baseinfo/material/consumable.vue
 * 还原交互：搜索(名称/SKU) / 详情 / 编辑 / 启用停用 / 加入采购计划(加入、保存、移除) / 安全库存修改(确认) / 阶梯采购价 / 主SKU列表(消耗量、待出库、待入库、辅料需求量) / 建议采购 / 采购记录 / 分页。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.consumable',
  title: '辅料管理',
  subtitle: 'WIMOOR 辅料管理功能迁移：辅料图片、名称/SKU、起订量、单价、品类、重量、供应商、需求量、库存与采购交互',
  addLabel: '新增辅料',
  searchPlaceholder: '名称/SKU',
  columns: [
    { key: 'image', label: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="辅料图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: '名称/SKU', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'amount', label: '起订量', width: 100, numeric: true },
    { key: 'price', label: '单价', width: 100, render: (row) => row.price ? <span className="text-orange-ink">￥{String(row.price)}</span> : <span className="text-muted">—</span> },
    { key: 'category', label: '品类', width: 140, render: (row) => (
      <span className="flex flex-col"><span>{String(row.category ?? '—')}</span><span className="text-muted">备注:{String(row.remark ?? '')}</span></span>
    ) },
    { key: 'weight', label: '重量(kg)', width: 110, numeric: true },
    { key: 'supplier', label: '供应商', width: 180, render: (row) => (
      <span className="flex flex-col"><span>{String(row.supplier ?? '—')}</span><span className="text-muted">供货周期：{String(row.delivery_cycle ?? '')}</span></span>
    ) },
    { key: 'needamount', label: '需求量', width: 110, numeric: true },
    { key: 'fulfillable', label: '可用库存', width: 120, numeric: true },
    { key: 'suggest', label: '建议采购', width: 120, numeric: true },
    { key: 'inbound', label: '采购数量', width: 110, numeric: true },
    { key: 'purchaseRecords', label: '采购记录', width: 110 },
  ],
  fields: [
    { key: 'code', label: '辅料编码', required: true, placeholder: '请输入辅料编码' },
    { key: 'name', label: '辅料名称', required: true, placeholder: '请输入辅料名称' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'image', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'amount', label: '起订量', kind: 'number', defaultValue: '0' },
    { key: 'price', label: '单价', kind: 'number', defaultValue: '0' },
    { key: 'category', label: '品类', placeholder: '请输入品类' },
    { key: 'weight', label: '重量(kg)', kind: 'number', defaultValue: '0' },
    { key: 'supplier', label: '供应商', placeholder: '请输入供应商' },
    { key: 'delivery_cycle', label: '供货周期', placeholder: '请输入供货周期' },
    { key: 'stockingCycle', label: '安全库存', kind: 'number', defaultValue: '0' },
    { key: 'needamount', label: '需求量', kind: 'number', defaultValue: '0' },
    { key: 'remark', label: '备注', placeholder: '请输入备注...' },
  ],
  extraFilters: [
    { key: 'delivery_cycle', label: '供货周期', placeholder: '请输入供货周期' },
    { key: 'amount', label: '消耗量', kind: 'number', placeholder: '请输入消耗量' },
    { key: 'outbound', label: '待出库', kind: 'number', placeholder: '请输入待出库数量' },
  ],
};

export default function WimoorConsumablePage() {
  return <MasterDataWorkbench config={config} />;
}
