'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 平台配对 → SKU配对」功能迁移。
 * 源组件：amazon/listing/relation_msku/index.vue
 * 还原交互：搜索(ASIN或平台SKU) / 店铺站点筛选 / 重新绑定(本地SKU↔MSKU 配对) / 系统自动绑定MSKU标识 / 组合品标识 / 导入 / 导出下载 / 关闭 / 分页。
 * 说明：以 document 类型单据承载 SKU↔MSKU 配对关系；导入/导出为外部文件操作，通用组件以列表与配对字段承载。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.skuRelation',
  title: 'SKU配对',
  subtitle: 'WIMOOR SKU配对功能迁移：平台商品信息与本地产品信息的 MSKU 绑定关系（用户显式创建才有数据）',
  type: 'document',
  addLabel: '新增配对',
  searchPlaceholder: '搜索ASIN或平台SKU',
  columns: [
    { key: 'msku', label: '平台商品信息', width: 220, render: (row) => (
      <span className="flex flex-col"><span>{String(row.pname ?? '—')}</span><span className="text-muted">{String(row.msku ?? '')} ASIN:{String(row.asin ?? '')}</span></span>
    ) },
    { key: 'fbaquantity', label: 'FBA库存', width: 110, numeric: true },
    { key: 'groupname', label: '店铺/站点', width: 150, render: (row) => <span>{String(row.groupname ?? '')}-{String(row.marketname ?? '')}</span> },
    { key: 'sku', label: '本地产品信息', width: 220, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">SKU:{String(row.sku ?? '')}{String(row.issfg ?? '') === '1' ? ' 组合' : ''}</span></span>
    ) },
    { key: 'fulfillable', label: '本地库存', width: 110, numeric: true },
    { key: 'price', label: '采购价格', width: 100, numeric: true },
    { key: 'pkgweight', label: '重量(kg)', width: 100, numeric: true },
    { key: 'omsku', label: '绑定MSKU', width: 160, render: (row) => row.omsku
      ? <span>{String(row.omsku)}</span>
      : <span className="text-muted">系统自动绑定MSKU</span> },
  ],
  fields: [
    { key: 'docNo', label: '配对单号', required: true, placeholder: '请输入配对单号' },
    { key: 'msku', label: '平台SKU(MSKU)', required: true, placeholder: '请输入平台SKU' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入ASIN' },
    { key: 'pname', label: '平台商品名称', placeholder: '请输入平台商品名称' },
    { key: 'pimage', label: '平台图片地址', placeholder: '请输入平台图片地址' },
    { key: 'sku', label: '本地SKU', required: true, placeholder: '请选择本地SKU' },
    { key: 'name', label: '本地产品名称', placeholder: '请输入本地产品名称' },
    { key: 'image', label: '本地图片地址', placeholder: '请输入本地图片地址' },
    { key: 'issfg', label: '组合品', kind: 'select', defaultValue: '0',
      options: [{ value: '0', label: '单品' }, { value: '1', label: '组合' }],
    },
    { key: 'groupname', label: '店铺', placeholder: '请输入店铺' },
    { key: 'marketname', label: '站点', placeholder: '请输入站点' },
    { key: 'fbaquantity', label: 'FBA库存', kind: 'number', defaultValue: '0' },
    { key: 'fulfillable', label: '本地库存', kind: 'number', defaultValue: '0' },
    { key: 'price', label: '采购价格', kind: 'number', defaultValue: '0' },
    { key: 'pkgweight', label: '重量(kg)', kind: 'number', defaultValue: '0' },
    { key: 'omsku', label: '已绑定MSKU', placeholder: '请输入已绑定MSKU' },
    { key: 'status', label: '配对状态', kind: 'select', defaultValue: 'DRAFT',
      options: [{ value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '已提交' }, { value: 'COMPLETED', label: '已完成' }, { value: 'CANCELLED', label: '已关闭' }],
    },
  ],
  extraFilters: [
    { key: 'groupname', label: '店铺/站点', placeholder: '请输入店铺或站点' },
  ],
  transitions: [
    { to: 'SUBMITTED', label: '提交' },
    { to: 'CANCELLED', label: '关闭' },
  ],
};

export default function WimoorSkuRelationPage() {
  return <MasterDataWorkbench config={config} />;
}
