'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 本地账目 → 其它费用」口径对照入口。
 * 源组件：amazon/payment/costSharing/index.vue。
 * 等价页已存在：/fin/expenses，本页为 WIMOOR 口径对照入口。
 * 还原交互：其它费用项下拉、搜索类型(单据号/SKU/创建人)、费用明细核心列、显式新增与分页；
 * 添加费用/费用类型管理/分摊规则/导入分摊费/导出/重置由等价页承载，不重复造。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'account.otherExpenses',
  title: '其它费用',
  subtitle: '等价页已存在（/fin/expenses），本页为 WIMOOR 口径对照入口；费用项、单据号、SKU、创建人字段按源 Vue 还原。',
  addLabel: '添加费用',
  searchPlaceholder: '请输入',
  columns: [
    { key: 'itemName', label: '其它费用项', width: 160 },
    { key: 'docNo', label: '单据号', width: 150 },
    { key: 'sku', label: 'SKU', width: 140 },
    { key: 'amount', label: '费用金额', width: 120, numeric: true },
    { key: 'currency', label: '币种', width: 90 },
    { key: 'sharingRule', label: '分摊规则', width: 140 },
    { key: 'createdBy', label: '创建人', width: 110 },
    { key: 'createdAt', label: '创建时间', width: 160 },
  ],
  fields: [
    { key: 'itemName', label: '其它费用项', required: true, placeholder: '请选择其它费用项' },
    { key: 'docNo', label: '单据号', placeholder: '请输入单据号' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'amount', label: '费用金额', kind: 'number' },
    { key: 'currency', label: '币种', kind: 'select', defaultValue: 'CNY',
      options: [{ value: 'CNY', label: '人民币' }, { value: 'USD', label: '美元' }, { value: 'SITE', label: '站点币种' }] },
    { key: 'sharingRule', label: '分摊规则', placeholder: '请输入分摊规则' },
    { key: 'createdBy', label: '创建人', placeholder: '请输入创建人' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'itemName', label: '其它费用项', placeholder: '请选择其它费用项' },
    { key: 'searchType', label: '搜索类型', kind: 'select', defaultValue: 'docNo',
      options: [
        { value: 'docNo', label: '单据号' }, { value: 'sku', label: 'SKU' }, { value: 'createdBy', label: '创建人' },
      ] },
  ],
};

export default function WimoorAccountOtherExpensesPage() {
  return <MasterDataWorkbench config={config} />;
}
