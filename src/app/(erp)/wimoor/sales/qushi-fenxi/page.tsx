'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → listing → 趋势分析」功能迁移（新增页）。
 * 源组件：amazon/listing/analysis/index.vue + components/data_deatils.vue
 * 还原交互：搜索类型(平台SKU、ASIN、本地SKU、商品名称、子SKU、子ASIN、父ASIN) / 关键词(请输入) /
 * 店铺站点切换 / SKU列表选中 / 详情(图片、名称、SKU、ASIN、首次上架日期、备注、跳转亚马逊) /
 * 页签(销量、历史排名) / 时间范围(近7天、近30天、近90天) / 日期筛选 / 19 项趋势指标 / 指标明细表 / 分页。
 * 说明：右侧 ECharts 图表与明细表在通用工作台中以「指标 + 时间范围 + 明细字段」口径承载。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.trendAnalysis',
  title: '趋势分析',
  subtitle: 'WIMOOR 趋势分析迁移：搜索类型(SKU/ASIN/本地SKU/子SKU等)、详情备注、销量/历史排名页签、近7/30/90天与19项指标',
  addLabel: '新增分析SKU',
  searchPlaceholder: '请输入',
  columns: [
    { key: 'image', label: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: 'SKU', width: 180 },
    { key: 'name', label: '商品名称', width: 200 },
    { key: 'asin', label: 'ASIN', width: 150 },
    { key: 'groupname', label: '店铺', width: 130 },
    { key: 'marketname', label: '站点', width: 110 },
    { key: 'opendate', label: '首次上架日期', width: 130 },
    { key: 'anysisremark', label: '备注', width: 180 },
    { key: 'link', label: '跳转链接', width: 160 },
  ],
  fields: [
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入 SKU' },
    { key: 'name', label: '商品名称', placeholder: '请输入商品名称' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入 ASIN' },
    { key: 'image', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'groupname', label: '店铺', placeholder: '请输入店铺' },
    { key: 'marketname', label: '站点', placeholder: '请输入站点' },
    { key: 'opendate', label: '首次上架日期', kind: 'date' },
    { key: 'anysisremark', label: '备注', placeholder: '请输入备注' },
    { key: 'link', label: '跳转亚马逊链接', placeholder: '请输入链接' },
  ],
  extraFilters: [
    { key: 'ftype', label: '搜索类型', kind: 'select', defaultValue: 'sku',
      options: [
        { value: 'sku', label: '平台SKU' }, { value: 'asin', label: 'ASIN' },
        { value: 'msku', label: '本地SKU' }, { value: 'name', label: '商品名称' },
        { value: 'childsku', label: '子SKU' }, { value: 'childasin', label: '子ASIN' },
        { value: 'parentasin', label: '父ASIN' },
      ],
    },
    { key: 'tab', label: '分析页签', kind: 'select', defaultValue: 'sales',
      options: [{ value: 'sales', label: '销量' }, { value: 'hisrank', label: '历史排名' }],
    },
    { key: 'times', label: '时间范围', kind: 'select', defaultValue: '近7天',
      options: [
        { value: '近7天', label: '近7天' }, { value: '近30天', label: '近30天' },
        { value: '近90天', label: '近90天' },
      ],
    },
    { key: 'metric', label: '趋势指标', kind: 'select', defaultValue: '销量',
      options: [
        { value: '销量', label: '销量' }, { value: '销售订单', label: '销售订单' },
        { value: '商品总销售额', label: '商品总销售额' }, { value: '商品排名', label: '商品排名' },
        { value: '访问人数', label: '访问人数' }, { value: '页面浏览数量', label: '页面浏览数量' },
        { value: '购物车比例', label: '购物车比例' }, { value: '销售转化率', label: '销售转化率' },
        { value: '广告点击量', label: '广告点击量' }, { value: '广告展示量', label: '广告展示量' },
        { value: '广告点击率', label: '广告点击率' }, { value: '广告花费', label: '广告花费' },
        { value: '广告点击花费', label: '广告点击花费' }, { value: 'Acos', label: 'Acos' },
        { value: 'AcoAs', label: 'AcoAs' }, { value: '广告转化率', label: '广告转化率' },
        { value: '广告销售额', label: '广告销售额' }, { value: '广告销量', label: '广告销量' },
        { value: '广告销量占比', label: '广告销量占比' },
      ],
    },
    { key: 'startDate', label: '开始日期', kind: 'date' },
    { key: 'endDate', label: '结束日期', kind: 'date' },
  ],
};

export default function WimoorSalesTrendAnalysisPage() {
  return <MasterDataWorkbench config={config} />;
}
