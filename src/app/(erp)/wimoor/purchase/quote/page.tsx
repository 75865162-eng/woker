'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「采购 → 供应协同 → 采购报价单」功能迁移。
 * 源组件：erp/baseinfo/quote/index.vue
 * 还原交互：搜索(供应商/买家名称) / 详情 / 关闭 / 买家与供应商信息 / 商品图片·名称·数量·状态·单价·总价 / 备注 / 审核时间。
 * 注：code 为框架唯一键（报价单编码），必填以保证 upsert 幂等。
 */
const STATUS: Record<string, string> = { PENDING: '待审核', APPROVED: '已审核', REJECTED: '已驳回' };

const config: MasterDataWorkbenchConfig = {
  kind: 'purchase.quote',
  type: 'entry',
  title: '采购报价单',
  subtitle: 'WIMOOR 采购报价单迁移：买家/供应商信息、商品数量单价总价、状态与审核时间完整交互',
  addLabel: '新增报价单',
  searchPlaceholder: '请输入供应商/买家名称',
  columns: [
    { key: 'code', label: '报价单编码', width: 150 },
    { key: 'buyerName', label: '买家名称', width: 140 },
    { key: 'buyerCompany', label: '买家公司', width: 160 },
    { key: 'buyerMobile', label: '买家电话', width: 130 },
    { key: 'supplierName', label: '供应商名称', width: 140 },
    { key: 'supplierCompany', label: '供应商公司', width: 160 },
    { key: 'supplierPhone', label: '供应商电话', width: 130 },
    { key: 'supplierMobile', label: '供应商手机', width: 130 },
    { key: 'name', label: '商品名称', width: 180 },
    { key: 'quantity', label: '数量', width: 90, numeric: true },
    { key: 'price', label: '单价', width: 100, numeric: true },
    { key: 'amount', label: '总价', width: 110, numeric: true },
    { key: 'status', label: '状态', width: 100, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'auditTime', label: '审核时间', width: 160 },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'code', label: '报价单编码', required: true, placeholder: '请输入报价单编码' },
    { key: 'buyerName', label: '买家名称', placeholder: '请输入买家名称' },
    { key: 'buyerCompany', label: '买家公司', placeholder: '请输入买家公司' },
    { key: 'buyerMobile', label: '买家电话', placeholder: '请输入买家电话' },
    { key: 'supplierName', label: '供应商名称', placeholder: '请输入供应商名称' },
    { key: 'supplierCompany', label: '供应商公司', placeholder: '请输入供应商公司' },
    { key: 'supplierPhone', label: '供应商电话', placeholder: '请输入供应商电话' },
    { key: 'supplierMobile', label: '供应商手机', placeholder: '请输入供应商手机' },
    { key: 'name', label: '商品名称', placeholder: '请输入商品名称' },
    { key: 'quantity', label: '数量', kind: 'number' },
    { key: 'price', label: '单价', kind: 'number' },
    { key: 'amount', label: '总价', kind: 'number' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'PENDING',
      options: [
        { value: 'PENDING', label: '待审核' }, { value: 'APPROVED', label: '已审核' }, { value: 'REJECTED', label: '已驳回' },
      ],
    },
    { key: 'auditTime', label: '审核时间', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'supplierFilter', label: '供应商名称', placeholder: '请输入供应商名称' },
    { key: 'buyerFilter', label: '买家名称', placeholder: '请输入买家名称' },
    { key: 'statusFilter', label: '状态', kind: 'select',
      options: [
        { value: 'PENDING', label: '待审核' }, { value: 'APPROVED', label: '已审核' }, { value: 'REJECTED', label: '已驳回' },
      ],
    },
  ],
};

export default function WimoorPurchaseQuotePage() {
  return <MasterDataWorkbench config={config} />;
}
