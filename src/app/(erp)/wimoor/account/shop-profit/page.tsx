'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 店铺利润」口径对照入口。
 * 源组件：amazon/payment/profitReport/profitGroup/index.vue（店铺利润 / 月度结算 / 月度结算简洁版）。
 * 等价页已存在：/sellfox/profit，本页为 WIMOOR 口径对照入口。
 * 还原交互：店铺/站点搜索、币种筛选、店铺维度销售额-成本-广告-利润核心列、分页；
 * 图表与月度结算明细保留在等价页，不臆造净利润。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.shopProfit',
  title: '店铺利润',
  subtitle: '等价页已存在（/sellfox/profit），本页为 WIMOOR 口径对照入口；按店铺汇总销售额、采购成本、头程、广告、佣金与利润。',
  addLabel: '新增店铺利润记录',
  searchPlaceholder: '搜索店铺',
  columns: [
    { key: 'shopName', label: '店铺', width: 160 },
    { key: 'marketplace', label: '站点', width: 110 },
    { key: 'period', label: '统计周期', width: 130 },
    { key: 'currency', label: '币种', width: 90 },
    { key: 'salesAmount', label: '销售额', width: 120, numeric: true },
    { key: 'purchaseCost', label: '采购成本', width: 120, numeric: true },
    { key: 'firstLegFee', label: '头程运费', width: 120, numeric: true },
    { key: 'adFee', label: '广告费', width: 110, numeric: true },
    { key: 'commission', label: '平台佣金', width: 110, numeric: true },
    { key: 'profit', label: '利润', width: 120, numeric: true },
  ],
  fields: [
    { key: 'shopName', label: '店铺', required: true, placeholder: '请输入店铺' },
    { key: 'marketplace', label: '站点', placeholder: '请输入站点' },
    { key: 'period', label: '统计周期', placeholder: '例如 2026-11' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
    { key: 'salesAmount', label: '销售额', kind: 'number' },
    { key: 'purchaseCost', label: '采购成本', kind: 'number' },
    { key: 'firstLegFee', label: '头程运费', kind: 'number' },
    { key: 'adFee', label: '广告费', kind: 'number' },
    { key: 'commission', label: '平台佣金', kind: 'number' },
    { key: 'profit', label: '利润', kind: 'number' },
  ],
  extraFilters: [
    { key: 'currency', label: '币种', kind: 'select',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
    { key: 'marketplace', label: '站点', placeholder: '请输入站点' },
    { key: 'period', label: '统计周期', placeholder: '例如 2026-11' },
  ],
};

export default function WimoorAccountShopProfitPage() {
  return <MasterDataWorkbench config={config} />;
}
