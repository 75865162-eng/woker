'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 辅料包材 → 箱子管理（包材）」功能迁移。
 * 源组件：erp/baseinfo/material/package.vue
 * 还原交互：搜索(名称/SKU) / 详情 / 编辑 / 启用停用 / 阶梯采购价 / 产品库存(仓库名称、库存) / 在途库存 / 分页。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.package',
  title: '箱子管理',
  subtitle: 'WIMOOR 箱子（包材）管理功能迁移：名称/SKU、起订量、单价、品类、重量、供应商、库存与在途库存交互',
  addLabel: '新增包材',
  searchPlaceholder: '名称/SKU',
  columns: [
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
    { key: 'fulfillable', label: '可用库存', width: 120, numeric: true },
    { key: 'warehouse', label: '仓库名称', width: 140 },
    { key: 'quantity', label: '库存', width: 100, numeric: true },
    { key: 'inbound', label: '在途库存', width: 110, numeric: true },
  ],
  fields: [
    { key: 'code', label: '包材编码', required: true, placeholder: '请输入包材编码' },
    { key: 'name', label: '包材名称', required: true, placeholder: '请输入包材名称' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'amount', label: '起订量', kind: 'number', defaultValue: '0' },
    { key: 'price', label: '单价', kind: 'number', defaultValue: '0' },
    { key: 'category', label: '品类', placeholder: '请输入品类' },
    { key: 'weight', label: '重量(kg)', kind: 'number', defaultValue: '0' },
    { key: 'supplier', label: '供应商', placeholder: '请输入供应商' },
    { key: 'delivery_cycle', label: '供货周期', placeholder: '请输入供货周期' },
    { key: 'warehouse', label: '仓库名称', placeholder: '请输入仓库名称' },
    { key: 'quantity', label: '库存', kind: 'number', defaultValue: '0' },
    { key: 'inbound', label: '在途库存', kind: 'number', defaultValue: '0' },
    { key: 'remark', label: '备注', placeholder: '请输入备注...' },
  ],
  extraFilters: [
    { key: 'delivery_cycle', label: '供货周期', placeholder: '请输入供货周期' },
  ],
  // 原版指标筛选弹窗：多指标组合筛选
  metricFilter: { storageKey: 'product.package' },
};

export default function WimoorPackagePage() {
  return <MasterDataWorkbench config={config} />;
}
