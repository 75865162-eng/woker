'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「采购 → 采购管理 → 采购单」功能迁移。
 * 源组件：erp/purchase/orders/index.vue
 * 还原交互：搜索/重置 / 搜索维度(SKU、订单号、运单号) / 收货状态(全部完成、付款完成、入库完成)
 *          / 添加采购单 / 批量审核 / 批量下单 / 自动付款 / 自动收货 / 导入付款 / 自动付运费
 *          / 物流单识别 / 导出SKU列表 / 批量修改产品备注 / 单据字段(单号、状态、供应商、下单日期、金额、备注)。
 * 注：批量动作映射为单据状态流转；导入/导出/识别类动作由等价页 /purchase/orders 承载。
 */
const STATUS: Record<string, string> = {
  PENDING: '待审核', AUDITED: '已审核', ORDERED: '已下单',
  PAID: '付款完成', RECEIVED: '入库完成', COMPLETED: '全部完成',
};

const config: MasterDataWorkbenchConfig = {
  kind: 'purchase.orders',
  type: 'document',
  title: '采购单',
  subtitle: 'WIMOOR 采购单迁移：单号/收货状态/供应商/下单日期/采购金额/备注，支持审核、下单、付款、收货流转',
  addLabel: '添加采购单',
  searchPlaceholder: '采购单号/供应商',
  columns: [
    { key: 'docNo', label: '采购单号', width: 160 },
    { key: 'status', label: '收货状态', width: 110, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'partnerCode', label: '供应商', width: 160 },
    { key: 'businessDate', label: '下单日期', width: 140 },
    { key: 'currency', label: '币种', width: 80 },
    { key: 'amount', label: '采购金额', width: 120, numeric: true },
    { key: 'remark', label: '备注', width: 200 },
  ],
  fields: [
    { key: 'docNo', label: '采购单号', required: true, placeholder: '请输入采购单号' },
    { key: 'partnerCode', label: '供应商', placeholder: '请输入供应商编码/名称' },
    { key: 'businessDate', label: '下单日期', kind: 'date' },
    { key: 'status', label: '收货状态', kind: 'select', defaultValue: 'PENDING',
      options: [
        { value: 'PENDING', label: '待审核' }, { value: 'AUDITED', label: '已审核' },
        { value: 'ORDERED', label: '已下单' }, { value: 'PAID', label: '付款完成' },
        { value: 'RECEIVED', label: '入库完成' }, { value: 'COMPLETED', label: '全部完成' },
      ],
    },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }],
    },
    { key: 'amount', label: '采购金额', kind: 'number', placeholder: '请输入采购金额' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'searchType', label: '搜索维度', kind: 'select', defaultValue: 'sku',
      options: [
        { value: 'sku', label: 'SKU' }, { value: 'number', label: '订单号' }, { value: 'waybill', label: '运单号' },
      ],
    },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'waybillNo', label: '运单号', placeholder: '请输入运单号' },
    { key: 'receiveStatus', label: '收货状态', kind: 'select',
      options: [
        { value: 'COMPLETED', label: '全部完成' }, { value: 'PAID', label: '付款完成' }, { value: 'RECEIVED', label: '入库完成' },
      ],
    },
  ],
  transitions: [
    { to: 'AUDITED', label: '审核' }, { to: 'ORDERED', label: '下单' },
    { to: 'PAID', label: '付款' }, { to: 'RECEIVED', label: '收货' },
  ],
  // 原版指标筛选弹窗：多指标组合筛选
  metricFilter: { storageKey: 'purchase.orders' },
};

export default function WimoorPurchaseOrdersPage() {
  return <MasterDataWorkbench config={config} />;
}
