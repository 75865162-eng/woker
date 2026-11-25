'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 利润报表」口径对照入口。
 * 源组件：amazon/payment/profitReport/index.vue。
 * 等价页已存在：/operations/profit-report，本页为 WIMOOR 口径对照入口。
 * 还原交互：搜索(请输入)/重置、币种(人民币/美元/站点币种)、维度(MSKU/ASIN/父ASIN/SKU/产品名称)筛选、
 * 搜索结果与分页；导出/导出（旧）/重算按钮属于等价页完整实现，本对照页不重复造。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.profitReport',
  title: '利润报表',
  subtitle: '等价页已存在（/operations/profit-report），本页为 WIMOOR 口径对照入口；币种与统计维度按源 Vue 选项还原。',
  addLabel: '新增利润报表记录',
  searchPlaceholder: '请输入',
  columns: [
    { key: 'name', label: '产品名称', width: 200 },
    { key: 'sku', label: 'SKU', width: 130 },
    { key: 'msku', label: 'MSKU', width: 130 },
    { key: 'asin', label: 'ASIN', width: 130 },
    { key: 'parentAsin', label: '父ASIN', width: 130 },
    { key: 'currency', label: '币种', width: 90 },
    { key: 'salesAmount', label: '销售额', width: 110, numeric: true },
    { key: 'cost', label: '成本', width: 110, numeric: true },
    { key: 'adFee', label: '广告费', width: 110, numeric: true },
    { key: 'tax', label: '税费', width: 100, numeric: true },
    { key: 'profit', label: '利润', width: 110, numeric: true },
  ],
  fields: [
    { key: 'name', label: '产品名称', required: true, placeholder: '请输入产品名称' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'msku', label: 'MSKU', placeholder: '请输入MSKU' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入ASIN' },
    { key: 'parentAsin', label: '父ASIN', placeholder: '请输入父ASIN' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
    { key: 'salesAmount', label: '销售额', kind: 'number' },
    { key: 'cost', label: '成本', kind: 'number' },
    { key: 'adFee', label: '广告费', kind: 'number' },
    { key: 'tax', label: '税费', kind: 'number' },
    { key: 'profit', label: '利润', kind: 'number' },
  ],
  extraFilters: [
    { key: 'currency', label: '币种', kind: 'select',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
    { key: 'dimension', label: '统计维度', kind: 'select', defaultValue: 'sku',
      options: [
        { value: 'msku', label: 'MSKU' }, { value: 'asin', label: 'ASIN' }, { value: 'parentAsin', label: '父ASIN' },
        { value: 'sku', label: 'SKU' }, { value: 'name', label: '产品名称' },
      ] },
  ],
};

export default function WimoorAccountProfitReportPage() {
  return <MasterDataWorkbench config={config} />;
}
