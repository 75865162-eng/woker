'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 平台账目 → 赔偿费用」功能迁移（新增页）。
 * 源组件：amazon/report/reimbursements_fee/index.vue。
 * 还原交互：店铺/日期筛选、搜索「ASIN或平台SKU」、导出；9 个表格列按源 Vue 全量还原
 * （平台商品信息含图片/名称/SKU/ASIN，费用时间含订单号，报销原因含报销号）；
 * 用户显式补录才有数据，框架不预置伪造数据，导出交互沿用等价报表口径。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.reimbursements',
  title: '赔偿费用',
  subtitle: 'WIMOOR 赔偿费用迁移：平台商品信息、费用时间、报销原因、金额、币种与偿还/报销数量完整交互。',
  addLabel: '新增赔偿费用记录',
  searchPlaceholder: '搜索ASIN或平台SKU',
  columns: [
    {
      key: 'sku', label: '平台商品信息', width: 240,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(row.name ?? '') || '—'}</span>
          <span className="text-muted">{String(row.sku ?? '')} ASIN:{String(row.asin ?? '')}</span>
        </span>
      ),
    },
    {
      key: 'approval_date', label: '费用时间', width: 200,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(row.approval_date ?? '') || '—'}</span>
          <span className="text-muted">订单号:{String(row.amazon_order_id ?? '')}</span>
        </span>
      ),
    },
    {
      key: 'reason', label: '报销原因', width: 220,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(row.reason ?? '') || '—'}</span>
          <span className="text-muted">报销号:{String(row.reimbursement_id ?? '')}</span>
        </span>
      ),
    },
    { key: 'amount_per_unit', label: '每个金额', width: 110, numeric: true },
    { key: 'amount_total', label: '总金额', width: 110, numeric: true },
    { key: 'currency_unit', label: '币种', width: 90 },
    { key: 'quantity_reimbursed_cash', label: '已偿还数量', width: 120, numeric: true },
    { key: 'quantity_reimbursed_inventory', label: '已报销数量', width: 120, numeric: true },
    { key: 'quantity_reimbursed_total', label: '已报数量总计', width: 130, numeric: true },
  ],
  fields: [
    { key: 'sku', label: '平台SKU', required: true, placeholder: '请输入平台SKU' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入ASIN' },
    { key: 'name', label: '产品名称', placeholder: '请输入产品名称' },
    { key: 'approval_date', label: '费用时间', kind: 'date' },
    { key: 'amazon_order_id', label: '订单号', placeholder: '请输入订单号' },
    { key: 'reimbursement_id', label: '报销号', placeholder: '请输入报销号' },
    { key: 'reason', label: '报销原因', placeholder: '请输入报销原因' },
    { key: 'amount_per_unit', label: '每个金额', kind: 'number' },
    { key: 'amount_total', label: '总金额', kind: 'number' },
    { key: 'currency_unit', label: '币种', placeholder: '请输入币种' },
    { key: 'quantity_reimbursed_cash', label: '已偿还数量', kind: 'number' },
    { key: 'quantity_reimbursed_inventory', label: '已报销数量', kind: 'number' },
    { key: 'quantity_reimbursed_total', label: '已报数量总计', kind: 'number' },
  ],
  extraFilters: [
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'toDate', label: '结束日期', kind: 'date' },
    { key: 'groupid', label: '店铺', placeholder: '请输入店铺' },
    { key: 'marketplaceid', label: '站点', placeholder: '请输入站点' },
    { key: 'currency_unit', label: '币种', placeholder: '请输入币种' },
  ],
};

export default function WimoorAccountReimbursementsPage() {
  return <MasterDataWorkbench config={config} />;
}
