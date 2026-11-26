'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 基础产品 → 产品管理」功能迁移（1:1 功能对齐）。
 * 源组件：erp/baseinfo/material/index.vue + components/header.vue
 * 还原交互（对齐原版 header.vue）：
 *   - 搜索类型下拉：SKU / 产品名称 / 供应商 / 备注
 *   - 常驻筛选：全部供应商 / 产品负责人 / 品类 / 标签 / 启用状态
 *   - 高级筛选：产品类型(全部/单独/组合/待组装) / 本地SKU / 产品名称 / 备注
 *   - 功能行：添加产品 / 导入数据(8项) / 导出数据(8项) / 同步图片尺寸 / 批量操作(6项) / 帮助
 *   - 表格多选 + 详情 / 编辑 / 停用 / 启用 / 标签修改；阶梯价 / 库存 / 标签列
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.master',
  title: '产品管理',
  subtitle: 'WIMOOR 产品管理功能迁移：图片、名称/SKU、品类、成本、库存等列（用户显式创建才有数据）',
  addLabel: '添加产品',
  searchPlaceholder: '请输入（按所选搜索类型）',
  helpText: '产品管理：供应商/负责人/品类/标签多维筛选；导入导出支持产品、图片、供应商、备选供应商、辅料、海关、组装关系；批量支持启用/停用/采购/批量修改/同步亚马逊SKU。数据由当前工作区用户显式创建，不预置伪造数据。',
  searchTypes: [
    { value: 'sku', label: 'SKU' },
    { value: 'name', label: '产品名称' },
    { value: 'supplier', label: '供应商' },
    { value: 'remark', label: '备注' },
  ],
  quickFilters: [
    { key: 'supplier', label: '供应商', options: [{ value: '', label: '全部供应商' }] },
    { key: 'owner', label: '产品负责人', options: [{ value: '', label: '全部负责人' }] },
    { key: 'category', label: '品类', options: [{ value: '', label: '全部品类' }] },
    { key: 'tags', label: '标签', options: [{ value: '', label: '请选择标签' }] },
    { key: 'isDelete', label: '状态', options: [{ value: '0', label: '启用' }, { value: '1', label: '停用' }] },
  ],
  extraFilters: [
    { key: 'productType', label: '产品类型', kind: 'select', options: [
      { value: '', label: '全部产品' }, { value: '0', label: '单独产品' },
      { value: '1', label: '组合产品' }, { value: '2', label: '待组装产品' },
    ] },
    { key: 'searchlist', label: '本地SKU', kind: 'textarea', placeholder: '请输入本地SKU，以英文逗号分隔' },
    { key: 'productname', label: '产品名称', kind: 'textarea', placeholder: '请输入产品名称' },
    { key: 'remark', label: '备注', kind: 'textarea', placeholder: '请输入备注' },
  ],
  dropdownMenus: [
    { key: 'import', label: '导入数据', icon: 'import', items: [
      { key: 'import-base', label: '导入产品' }, { key: 'import-image', label: '导入图片' },
      { key: 'import-supplier', label: '导入供应商' }, { key: 'import-moresupplier', label: '导入备选供应商' },
      { key: 'import-cons', label: '导入辅料' }, { key: 'import-customs', label: '导入海关' },
      { key: 'import-box', label: '导入箱子' }, { key: 'import-assembly', label: '导入组装关系' },
    ] },
    { key: 'export', label: '导出数据', icon: 'export', items: [
      { key: 'export-base', label: '导出产品' }, { key: 'export-supplier', label: '导出供应商' },
      { key: 'export-moresupplier', label: '导出备选供应商' }, { key: 'export-cons', label: '导出辅料' },
      { key: 'export-customs', label: '导出海关' }, { key: 'export-box', label: '导出箱子' },
      { key: 'export-plan', label: '导出计划' }, { key: 'export-assembly', label: '导出组装关系' },
    ] },
    { key: 'batch', label: '批量操作', icon: 'batch', requiresSelection: true, items: [
      { key: 'batch-enable', label: '启用' }, { key: 'batch-disable', label: '停用' },
      { key: 'batch-purchase', label: '采购' }, { key: 'batch-edit', label: '批量修改' },
      { key: 'batch-sync-sku', label: '同步亚马逊SKU' }, { key: 'batch-barcode', label: '打印条码' },
    ] },
  ],
  selectable: true,
  importable: true,
  exportable: true,
  columns: [
    { key: 'image', label: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="产品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: '名称/SKU', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'createdate', label: '生效日期', width: 120, sortable: true },
    { key: 'category', label: '品类', width: 140, sortable: true },
    { key: 'weight', label: '重量(kg)', width: 100, numeric: true, sortable: true },
    { key: 'cost', label: '采购成本', width: 110, sortable: true, render: (row) => row.cost ? <span className="text-orange-ink">￥{String(row.cost)}</span> : <span className="text-muted">—</span> },
    { key: 'amount', label: '起订量', width: 100, numeric: true },
    { key: 'price', label: '单价', width: 100, numeric: true },
    { key: 'supplier', label: '供应商', width: 160, sortable: true },
    { key: 'fulfillable', label: '可用库存', width: 110, numeric: true, sortable: true },
    { key: 'warehouse', label: '仓库名称', width: 140 },
    { key: 'quantity', label: '库存', width: 100, numeric: true },
    { key: 'unit', label: '单位', width: 80 },
    { key: 'tags', label: '标签', width: 160 },
    { key: 'remark', label: '备注', sortable: true },
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
    { key: 'owner', label: '产品负责人', placeholder: '请输入负责人' },
    { key: 'warehouse', label: '仓库名称', placeholder: '请输入仓库名称' },
    { key: 'quantity', label: '库存', kind: 'number', defaultValue: '0' },
    { key: 'unit', label: '单位', placeholder: '请输入单位' },
    { key: 'tags', label: '标签', placeholder: '请输入标签，多个用逗号分隔' },
    { key: 'createdate', label: '生效日期', kind: 'date' },
    { key: 'remark', label: '备注', kind: 'textarea', placeholder: '请输入备注...' },
  ],
};

export default function WimoorProductMasterPage() {
  return <MasterDataWorkbench config={config} />;
}
