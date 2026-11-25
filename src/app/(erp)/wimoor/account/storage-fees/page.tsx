'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 平台账目 → FBA仓储费」口径对照入口。
 * 源组件：amazon/report/storage_fee/index.vue（仓储费 / 超龄库存附加费 两个页签）。
 * 等价页已存在：/amazon/storage-fees，本页为 WIMOOR 口径对照入口。
 * 还原交互：费用类型(仓储费/超龄库存附加费)与 SKU/站点筛选、仓储费明细核心列、分页；
 * 完整费用报表与导出保留在等价页。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.storageFees',
  title: 'FBA仓储费',
  subtitle: '等价页已存在（/amazon/storage-fees），本页为 WIMOOR 口径对照入口；按仓储费/超龄库存附加费两类口径对照。',
  addLabel: '新增仓储费记录',
  searchPlaceholder: '搜索SKU/ASIN',
  columns: [
    { key: 'sku', label: '平台SKU', width: 140 },
    { key: 'asin', label: 'ASIN', width: 130 },
    { key: 'name', label: '产品名称', width: 180 },
    { key: 'marketplace', label: '站点', width: 100 },
    { key: 'feeMonth', label: '费用月份', width: 120 },
    { key: 'feeType', label: '费用类型', width: 140 },
    { key: 'storageFee', label: '仓储费', width: 110, numeric: true },
    { key: 'longTermFee', label: '超龄库存附加费', width: 140, numeric: true },
    { key: 'currency', label: '币种', width: 90 },
  ],
  fields: [
    { key: 'sku', label: '平台SKU', required: true, placeholder: '请输入平台SKU' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入ASIN' },
    { key: 'name', label: '产品名称', placeholder: '请输入产品名称' },
    { key: 'marketplace', label: '站点', placeholder: '请输入站点' },
    { key: 'feeMonth', label: '费用月份', placeholder: '例如 2026-11' },
    { key: 'feeType', label: '费用类型', kind: 'select', defaultValue: 'storage',
      options: [{ value: 'storage', label: '仓储费' }, { value: 'longTerm', label: '超龄库存附加费' }] },
    { key: 'storageFee', label: '仓储费', kind: 'number' },
    { key: 'longTermFee', label: '超龄库存附加费', kind: 'number' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
  ],
  extraFilters: [
    { key: 'feeType', label: '费用类型', kind: 'select',
      options: [{ value: 'storage', label: '仓储费' }, { value: 'longTerm', label: '超龄库存附加费' }] },
    { key: 'feeMonth', label: '费用月份', placeholder: '例如 2026-11' },
    { key: 'currency', label: '币种', kind: 'select',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
  ],
};

export default function WimoorAccountStorageFeesPage() {
  return <MasterDataWorkbench config={config} />;
}
