'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 账期SKU」口径对照入口。
 * 源组件：amazon/payment/settlement_sku/index.vue（SKU详情 / 账期SKU 两个页签）。
 * 等价页已存在：/operations/settlement-sku-pivot，本页为 WIMOOR 口径对照入口。
 * 还原交互：SKU/ASIN 搜索、账期/站点/币种筛选、账期 SKU 明细核心列、分页；
 * SKU 详情透视图表保留在等价页。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.settlementSku',
  title: '账期SKU',
  subtitle: '等价页已存在（/operations/settlement-sku-pivot），本页为 WIMOOR 口径对照入口；按账期还原 SKU/MSKU/ASIN 明细列。',
  addLabel: '新增账期SKU记录',
  searchPlaceholder: '搜索SKU/ASIN',
  columns: [
    { key: 'sku', label: 'SKU', width: 140 },
    { key: 'msku', label: 'MSKU', width: 130 },
    { key: 'asin', label: 'ASIN', width: 130 },
    { key: 'marketplace', label: '站点', width: 100 },
    { key: 'period', label: '账期', width: 130 },
    { key: 'quantity', label: '数量', width: 90, numeric: true },
    { key: 'salesAmount', label: '销售额', width: 110, numeric: true },
    { key: 'refundAmount', label: '退款', width: 110, numeric: true },
    { key: 'feeAmount', label: '费用', width: 110, numeric: true },
    { key: 'settlementAmount', label: '结算金额', width: 120, numeric: true },
    { key: 'currency', label: '币种', width: 90 },
  ],
  fields: [
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入SKU' },
    { key: 'msku', label: 'MSKU', placeholder: '请输入MSKU' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入ASIN' },
    { key: 'marketplace', label: '站点', placeholder: '请输入站点' },
    { key: 'period', label: '账期', placeholder: '例如 2026-11' },
    { key: 'quantity', label: '数量', kind: 'number' },
    { key: 'salesAmount', label: '销售额', kind: 'number' },
    { key: 'refundAmount', label: '退款', kind: 'number' },
    { key: 'feeAmount', label: '费用', kind: 'number' },
    { key: 'settlementAmount', label: '结算金额', kind: 'number' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
  ],
  extraFilters: [
    { key: 'period', label: '账期', placeholder: '例如 2026-11' },
    { key: 'marketplace', label: '站点', placeholder: '请输入站点' },
    { key: 'currency', label: '币种', kind: 'select',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
  ],
};

export default function WimoorAccountSettlementSkuPage() {
  return <MasterDataWorkbench config={config} />;
}
