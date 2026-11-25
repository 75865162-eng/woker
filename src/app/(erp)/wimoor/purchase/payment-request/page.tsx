'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「采购 → 采购管理 → 请款单」功能迁移。
 * 源组件：erp/finance/paymentRequest/index.vue
 * 还原交互：支付方式/请款类型筛选 / 请款单号·关联单号搜索 / 备注 / 新增请款单
 *          / 审核通过 / 审核驳回 / 付款 / 作废 / 修改付款方式 / 确认 / 搜索 / 重置 / 取消。
 * 字段还原：请款单号、采购单号、请款人、请款时间、费用项(采购货款/运费)、金额、支付方式。
 */
const STATUS: Record<string, string> = {
  DRAFT: '草稿', PENDING: '待审核', APPROVED: '审核通过',
  REJECTED: '审核驳回', PAID: '已付款', VOID: '已作废',
};

const config: MasterDataWorkbenchConfig = {
  kind: 'purchase.payment-request',
  type: 'document',
  title: '请款单',
  subtitle: 'WIMOOR 请款单迁移：请款单号/采购单号/请款人/请款时间/费用项/金额/支付方式，支持审核、付款、作废',
  addLabel: '新增请款单',
  searchPlaceholder: '请款单号/关联单号',
  columns: [
    { key: 'docNo', label: '请款单号', width: 150 },
    { key: 'purchaseNo', label: '采购单号', width: 150 },
    { key: 'partnerCode', label: '请款人', width: 120 },
    { key: 'businessDate', label: '请款时间', width: 150 },
    { key: 'feeItem', label: '费用项', width: 120, render: (row) => <span>{String(row.feeItem) === 'FREIGHT' ? '运费' : (String(row.feeItem) ? '采购货款' : '—')}</span> },
    { key: 'amount', label: '金额', width: 120, numeric: true },
    { key: 'payMethod', label: '支付方式', width: 120 },
    { key: 'status', label: '状态', width: 110, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '请款单号', required: true, placeholder: '请输入请款单号' },
    { key: 'purchaseNo', label: '采购单号', placeholder: '请输入关联采购单号' },
    { key: 'partnerCode', label: '请款人', placeholder: '请输入请款人' },
    { key: 'businessDate', label: '请款时间', kind: 'date' },
    { key: 'feeItem', label: '费用项', kind: 'select', defaultValue: 'GOODS',
      options: [{ value: 'GOODS', label: '采购货款' }, { value: 'FREIGHT', label: '运费' }],
    },
    { key: 'amount', label: '金额', kind: 'number', placeholder: '请输入金额' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }],
    },
    { key: 'payMethod', label: '支付方式', kind: 'select', placeholder: '请选择支付方式',
      options: [
        { value: 'BANK', label: '银行转账' }, { value: 'ALIPAY', label: '支付宝' },
        { value: 'WECHAT', label: '微信支付' }, { value: 'CASH', label: '现金' },
      ],
    },
    { key: 'requestType', label: '请款类型', kind: 'select', placeholder: '请选择请款类型',
      options: [{ value: 'GOODS', label: '采购货款' }, { value: 'FREIGHT', label: '运费' }],
    },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'PENDING',
      options: [
        { value: 'PENDING', label: '待审核' }, { value: 'APPROVED', label: '审核通过' },
        { value: 'REJECTED', label: '审核驳回' }, { value: 'PAID', label: '已付款' }, { value: 'VOID', label: '已作废' },
      ],
    },
    { key: 'remark', label: '备注', placeholder: '请输入备注...' },
  ],
  extraFilters: [
    { key: 'payMethodFilter', label: '支付方式', kind: 'select',
      options: [
        { value: 'BANK', label: '银行转账' }, { value: 'ALIPAY', label: '支付宝' },
        { value: 'WECHAT', label: '微信支付' }, { value: 'CASH', label: '现金' },
      ],
    },
    { key: 'requestTypeFilter', label: '请款类型', kind: 'select',
      options: [{ value: 'GOODS', label: '采购货款' }, { value: 'FREIGHT', label: '运费' }],
    },
    { key: 'searchType', label: '搜索维度', kind: 'select', defaultValue: 'number',
      options: [{ value: 'number', label: '请款单号' }, { value: 'related', label: '关联单号' }],
    },
  ],
  transitions: [
    { to: 'APPROVED', label: '审核通过' }, { to: 'REJECTED', label: '审核驳回' },
    { to: 'PAID', label: '付款' }, { to: 'VOID', label: '作废' },
  ],
};

export default function WimoorPurchasePaymentRequestPage() {
  return <MasterDataWorkbench config={config} />;
}
