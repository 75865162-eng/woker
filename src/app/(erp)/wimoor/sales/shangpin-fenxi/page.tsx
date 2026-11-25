'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → listing → 商品分析」功能迁移。
 * 源组件：amazon/listing/products/index.vue
 * 还原交互：搜索(全部显示状态/SKU) / 搜索类型(SKU、同级SKU、本地SKU、ASIN、同级ASIN、父ASIN) /
 * 指数过滤 / 添加条件 / 清空条件 / 重置 / 同步商品 / 批量同步FBA库存 / 批量修改负责人 /
 * 批量修改商品价格 / 批量修改销售状态 / 批量同步商品 / 批量下载本地SKU信息 / 确认 / 提交 / 分页。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/listings），承载核心列与筛选口径。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.listingAnalysis',
  title: '商品分析',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /sellfox/listings）：显示状态/销售状态/负责人/价格/FBA库存',
  addLabel: '新增商品',
  searchPlaceholder: '请输入 SKU',
  columns: [
    { key: 'image', label: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: '名称/SKU', width: 200 },
    { key: 'asin', label: 'ASIN', width: 140 },
    { key: 'displayStatus', label: '显示状态', width: 110 },
    { key: 'salesStatus', label: '销售状态', width: 110 },
    { key: 'owner', label: '负责人', width: 100 },
    { key: 'price', label: '商品价格', width: 110, numeric: true },
    { key: 'fbaStock', label: 'FBA库存', width: 100, numeric: true },
    { key: 'remark', label: '备注' },
  ],
  fields: [
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入 SKU' },
    { key: 'name', label: '商品名称', placeholder: '请输入商品名称' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入 ASIN' },
    { key: 'displayStatus', label: '显示状态', kind: 'select', defaultValue: '未隐藏',
      options: [
        { value: '未隐藏', label: '未隐藏' }, { value: '隐藏', label: '隐藏' },
        { value: '失效', label: '失效' }, { value: '不限', label: '不限' },
      ],
    },
    { key: 'salesStatus', label: '销售状态', placeholder: '产品销售状态' },
    { key: 'owner', label: '负责人', placeholder: '请输入负责人' },
    { key: 'price', label: '商品价格', kind: 'number', defaultValue: '0' },
    { key: 'fbaStock', label: 'FBA库存', kind: 'number', defaultValue: '0' },
    { key: 'remark', label: '备注', placeholder: '请输入备注...' },
  ],
  extraFilters: [
    { key: 'searchType', label: '搜索类型', kind: 'select', defaultValue: 'SKU',
      options: [
        { value: 'SKU', label: 'SKU' }, { value: '同级SKU', label: '同级SKU' },
        { value: '本地SKU', label: '本地SKU' }, { value: 'ASIN', label: 'ASIN' },
        { value: '同级ASIN', label: '同级ASIN' }, { value: '父ASIN', label: '父ASIN' },
      ],
    },
    { key: 'priceChangeRate', label: '价格变动', placeholder: '用%时请输入小数' },
  ],
};

export default function WimoorSalesListingAnalysisPage() {
  return <MasterDataWorkbench config={config} />;
}
