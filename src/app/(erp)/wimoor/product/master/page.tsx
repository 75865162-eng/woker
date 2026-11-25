'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 基础产品 → 产品管理」功能迁移。
 * 源组件：erp/baseinfo/material/index.vue
 * 还原交互：搜索(名称/SKU) / 详情 / 编辑 / 启用停用 / 添加标签 / 供货周期筛选 / 图片 / 名称SKU / 品类 / 重量 / 采购成本 / 起订量 / 单价 / 供应商 / 可用库存 / 仓库库存 / 单位 / 标签 / 备注 / 分页。
 * 说明：本项目已有等价页 /product（商品主档）；本页为 WIMOOR 菜单入口的迁移承载，保留完整列配置。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.master',
  title: '产品管理',
  subtitle: 'WIMOOR 产品管理功能迁移：图片、名称/SKU、品类、成本、库存等列（用户显式创建才有数据）',
  addLabel: '新增产品',
  searchPlaceholder: '名称/SKU',
  columns: [
    { key: 'image', label: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="产品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: '名称/SKU', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'createdate', label: '生效日期', width: 120 },
    { key: 'category', label: '品类', width: 140 },
    { key: 'weight', label: '重量(kg)', width: 100, numeric: true },
    { key: 'cost', label: '采购成本', width: 110, render: (row) => row.cost ? <span className="text-orange-ink">￥{String(row.cost)}</span> : <span className="text-muted">—</span> },
    { key: 'amount', label: '起订量', width: 100, numeric: true },
    { key: 'price', label: '单价', width: 100, numeric: true },
    { key: 'supplier', label: '供应商', width: 160 },
    { key: 'fulfillable', label: '可用库存', width: 110, numeric: true },
    { key: 'warehouse', label: '仓库名称', width: 140 },
    { key: 'quantity', label: '库存', width: 100, numeric: true },
    { key: 'unit', label: '单位', width: 80 },
    { key: 'tags', label: '标签', width: 160 },
    { key: 'remark', label: '备注' },
  ],
  fields: [
    { key: 'code', label: '产品编码', required: true, placeholder: '请输入产品编码' },
    { key: 'name', label: '产品名称', required: true, placeholder: '请输入产品名称' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'image', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'category', label: '品类', placeholder: '请输入品类' },
    { key: 'weight', label: '重量(kg)', kind: 'number', defaultValue: '0' },
    { key: 'cost', label: '采购成本', kind: 'number', defaultValue: '0' },
    { key: 'amount', label: '起订量', kind: 'number', defaultValue: '0' },
    { key: 'price', label: '单价', kind: 'number', defaultValue: '0' },
    { key: 'supplier', label: '供应商', placeholder: '请输入供应商' },
    { key: 'warehouse', label: '仓库名称', placeholder: '请输入仓库名称' },
    { key: 'quantity', label: '库存', kind: 'number', defaultValue: '0' },
    { key: 'unit', label: '单位', placeholder: '请输入单位' },
    { key: 'tags', label: '标签', placeholder: '请选择标签' },
    { key: 'remark', label: '备注', placeholder: '请输入备注...' },
  ],
  extraFilters: [
    { key: 'delivery_cycle', label: '供货周期', placeholder: '请输入供货周期' },
  ],
};

export default function WimoorProductMasterPage() {
  return <MasterDataWorkbench config={config} />;
}
