'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 业绩报告」口径对照入口。
 * 源组件：amazon/payment/performanpce/index.vue。
 * 等价页已存在：/sellfox/performance，本页为 WIMOOR 口径对照入口。
 * 还原交互：搜索(请输入)/重置、币种(人民币/美元/站点币种)、维度(MSKU/ASIN/父ASIN/SKU/产品名称)筛选、
 * 业绩核心列与分页；导出交互保留在等价页。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.performance',
  title: '业绩报告',
  subtitle: '等价页已存在（/sellfox/performance），本页为 WIMOOR 口径对照入口；币种与统计维度按源 Vue 选项还原。',
  addLabel: '新增业绩报告记录',
  searchPlaceholder: '请输入',
  columns: [
    { key: 'businessDate', label: '日期', width: 130 },
    { key: 'name', label: '产品名称', width: 180 },
    { key: 'sku', label: 'SKU', width: 130 },
    { key: 'msku', label: 'MSKU', width: 130 },
    { key: 'asin', label: 'ASIN', width: 130 },
    { key: 'marketplace', label: '站点', width: 100 },
    { key: 'quantity', label: '销量', width: 90, numeric: true },
    { key: 'salesAmount', label: '销售额', width: 110, numeric: true },
    { key: 'adCost', label: '广告花费', width: 110, numeric: true },
    { key: 'acos', label: 'ACOS', width: 90 },
    { key: 'currency', label: '币种', width: 90 },
  ],
  fields: [
    { key: 'businessDate', label: '日期', kind: 'date' },
    { key: 'name', label: '产品名称', required: true, placeholder: '请输入产品名称' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'msku', label: 'MSKU', placeholder: '请输入MSKU' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入ASIN' },
    { key: 'marketplace', label: '站点', placeholder: '请输入站点' },
    { key: 'quantity', label: '销量', kind: 'number' },
    { key: 'salesAmount', label: '销售额', kind: 'number' },
    { key: 'adCost', label: '广告花费', kind: 'number' },
    { key: 'acos', label: 'ACOS', placeholder: '请输入ACOS' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
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

export default function WimoorAccountPerformancePage() {
  return <MasterDataWorkbench config={config} />;
}
