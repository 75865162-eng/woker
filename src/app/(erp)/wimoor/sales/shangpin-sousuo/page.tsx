'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → listing → 商品搜索」功能迁移（新增页）。
 * 源组件：amazon/listing/catalog/index.vue
 * 还原交互：搜索(关键词，用;分割) / 站点语言(站点语言、英文en_US、中文zh_CN) / 搜索 / 导出 /
 * 上一页 / 下一页(工作台分页) / 总计条数 / 在结果中查找(品牌、分类多选) / 清除 / 确认。
 * 列：主图、ASIN、商品名称/品牌/分类、排名(分类排名与分组排名)、排名链接。
 * 说明：源页面为卡片视图，通用工作台以表格列承载同一批字段口径。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.productSearch',
  title: '商品搜索',
  subtitle: 'WIMOOR 商品搜索迁移：关键词(;分割)、站点语言、品牌/分类结果筛选、排名与导出',
  addLabel: '新增搜索结果',
  searchPlaceholder: '请输入用;分割',
  columns: [
    { key: 'image', label: '图片', width: 80, render: (row) => row.image
      ? <img src={String(row.image)} alt="商品图片" className="h-12 w-12 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'asin', label: 'ASIN', width: 150 },
    { key: 'itemName', label: '商品名称', width: 260 },
    { key: 'brand', label: '品牌', width: 130 },
    { key: 'classification', label: '分类', width: 160 },
    { key: 'rank', label: '排名', width: 120, numeric: true },
    { key: 'rankTitle', label: '排名类目', width: 180 },
    { key: 'link', label: '排名链接', width: 180 },
  ],
  fields: [
    { key: 'asin', label: 'ASIN', required: true, placeholder: '请输入 ASIN' },
    { key: 'itemName', label: '商品名称', placeholder: '请输入商品名称' },
    { key: 'image', label: '主图地址', placeholder: '请输入主图地址' },
    { key: 'brand', label: '品牌', placeholder: '请输入品牌' },
    { key: 'classification', label: '分类', placeholder: '请输入分类' },
    { key: 'rank', label: '排名', kind: 'number', defaultValue: '0' },
    { key: 'rankTitle', label: '排名类目', placeholder: '请输入排名类目' },
    { key: 'link', label: '排名链接', placeholder: '请输入排名链接' },
  ],
  extraFilters: [
    { key: 'locale', label: '站点语言', kind: 'select', defaultValue: '',
      options: [
        { value: '', label: '站点语言' }, { value: 'en_US', label: '英文' },
        { value: 'zh_CN', label: '中文' },
      ],
    },
    { key: 'brandNames', label: '品牌(在结果中查找)', placeholder: '在结果中查找品牌' },
    { key: 'classificationIds', label: '分类(在结果中查找)', placeholder: '在结果中查找分类' },
  ],
};

export default function WimoorSalesProductSearchPage() {
  return <MasterDataWorkbench config={config} />;
}
