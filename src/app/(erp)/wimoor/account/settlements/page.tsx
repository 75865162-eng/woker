'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 结算记录」口径对照入口。
 * 源组件：amazon/payment/record/index.vue（账期 / 汇总 / 图表 三个页签）。
 * 等价页已存在：/amazon/settlements，本页为 WIMOOR 口径对照入口。
 * 还原交互：账期/店铺搜索、币种/状态筛选、账期与汇总核心列、分页、显式新增结算记录；
 * 汇总图表与导出交互保留在等价页。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.settlementRecord',
  title: '结算记录',
  subtitle: '等价页已存在（/amazon/settlements），本页为 WIMOOR 口径对照入口；口径：账期、店铺、站点、币种、销售额/退款/费用/结算金额。',
  addLabel: '新增结算记录',
  searchPlaceholder: '搜索账期/店铺',
  columns: [
    { key: 'period', label: '账期', width: 140 },
    { key: 'shopName', label: '店铺', width: 150 },
    { key: 'marketplace', label: '站点', width: 110 },
    { key: 'currency', label: '币种', width: 90 },
    { key: 'orderCount', label: '订单量', width: 90, numeric: true },
    { key: 'salesAmount', label: '销售额', width: 120, numeric: true },
    { key: 'refundAmount', label: '退款额', width: 120, numeric: true },
    { key: 'feeAmount', label: '费用总额', width: 120, numeric: true },
    { key: 'settlementAmount', label: '结算金额', width: 130, numeric: true },
    { key: 'status', label: '状态', width: 100 },
  ],
  fields: [
    { key: 'period', label: '账期', required: true, placeholder: '例如 2026-11' },
    { key: 'shopName', label: '店铺', placeholder: '请输入店铺' },
    { key: 'marketplace', label: '站点', placeholder: '请输入站点' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
    { key: 'orderCount', label: '订单量', kind: 'number' },
    { key: 'salesAmount', label: '销售额', kind: 'number' },
    { key: 'refundAmount', label: '退款额', kind: 'number' },
    { key: 'feeAmount', label: '费用总额', kind: 'number' },
    { key: 'settlementAmount', label: '结算金额', kind: 'number' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: '待结算',
      options: [{ value: '待结算', label: '待结算' }, { value: '已结算', label: '已结算' }] },
  ],
  extraFilters: [
    { key: 'currency', label: '币种', kind: 'select',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
    { key: 'status', label: '状态', kind: 'select',
      options: [{ value: '待结算', label: '待结算' }, { value: '已结算', label: '已结算' }] },
    { key: 'marketplace', label: '站点', placeholder: '请输入站点' },
  ],
};

export default function WimoorAccountSettlementsPage() {
  return <MasterDataWorkbench config={config} />;
}
