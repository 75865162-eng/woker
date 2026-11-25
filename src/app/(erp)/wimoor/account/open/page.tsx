'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 账期未结算」功能迁移（新增页）。
 * 源组件：amazon/report/open/index.vue。
 * 还原交互：店铺/日期筛选、搜索「ASIN或平台SKU」（源 Vue 中该输入框被注释，本页保留搜索能力）、
 * 7 个表格列按源 Vue 全量还原（平台商品信息含名称/SKU/ASIN/站点，费用时间含订单号，
 * 费用类型含 ftypename 子行）、导出；数据由用户显式补录。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.open',
  title: '账期未结算',
  subtitle: 'WIMOOR 账期未结算迁移：商品信息、费用时间、数量/费用/币种、费用类型与事件类型完整交互。',
  addLabel: '新增未结算记录',
  searchPlaceholder: '搜索ASIN或平台SKU',
  columns: [
    {
      key: 'sku', label: '平台商品信息', width: 240,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(row.pname ?? row.name ?? '') || '—'}</span>
          <span className="text-muted">{String(row.sku ?? '')} ASIN:{String(row.asin ?? '')} 站点:{String(row.mname ?? '')}</span>
        </span>
      ),
    },
    {
      key: 'posted_date', label: '费用时间', width: 200,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(row.posted_date ?? '') || '—'}</span>
          <span className="text-muted">订单号:{String(row.amazon_order_id ?? '')}</span>
        </span>
      ),
    },
    { key: 'quantity', label: '数量', width: 90, numeric: true },
    { key: 'amount', label: '费用', width: 110, numeric: true },
    { key: 'currency', label: '费用币种', width: 100 },
    {
      key: 'ftype', label: '费用类型', width: 180,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(row.ftype ?? '') || '—'}</span>
          {row.ftypename ? <span className="text-muted">{String(row.ftypename)}</span> : null}
        </span>
      ),
    },
    { key: 'event_type', label: '事件类型', width: 120 },
  ],
  fields: [
    { key: 'sku', label: '平台SKU', required: true, placeholder: '请输入平台SKU' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入ASIN' },
    { key: 'pname', label: '产品名称', placeholder: '请输入产品名称' },
    { key: 'mname', label: '站点', placeholder: '请输入站点' },
    { key: 'posted_date', label: '费用时间', kind: 'date' },
    { key: 'amazon_order_id', label: '订单号', placeholder: '请输入订单号' },
    { key: 'quantity', label: '数量', kind: 'number' },
    { key: 'amount', label: '费用', kind: 'number' },
    { key: 'currency', label: '费用币种', placeholder: '请输入费用币种' },
    { key: 'ftype', label: '费用类型', placeholder: '请输入费用类型' },
    { key: 'ftypename', label: '费用类型名称', placeholder: '请输入费用类型名称' },
    { key: 'event_type', label: '事件类型', placeholder: '请输入事件类型' },
  ],
  extraFilters: [
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'endDate', label: '结束日期', kind: 'date' },
    { key: 'groupid', label: '店铺', placeholder: '请输入店铺' },
    { key: 'marketplaceid', label: '站点', placeholder: '请输入站点' },
  ],
};

export default function WimoorAccountOpenPage() {
  return <MasterDataWorkbench config={config} />;
}
