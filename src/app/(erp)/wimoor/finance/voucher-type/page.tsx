'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「财务 → 配置 → 凭证字管理」功能迁移。
 * 源组件：finance/vouchertype/index.vue
 * 还原交互：行内新增(凭证字) / 编辑 / 保存 / 删除确认 / 列表展示；字段：字、名称、位数、状态。
 * 说明：Vue 为行内编辑表格，本项目统一为「新增/编辑弹窗」CRUD 交互（保存/删除语义一致）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'finance.voucher-type',
  title: '凭证字管理',
  subtitle: 'WIMOOR 凭证字管理迁移：凭证字(字)、名称、位数、状态，用户显式创建才有数据',
  addLabel: '新增凭证字',
  searchPlaceholder: '凭证字名称',
  columns: [
    { key: 'word', label: '字', width: 120 },
    { key: 'name', label: '名称', width: 220 },
    { key: 'digits', label: '位数', width: 100, numeric: true },
    {
      key: 'status', label: '状态', width: 100,
      render: (row) => <span className={row.status === 'ACTIVE' ? 'text-success-ink' : 'text-muted'}>{row.status === 'ACTIVE' ? '启用' : '停用'}</span>,
    },
  ],
  fields: [
    { key: 'word', label: '字', required: true, placeholder: '请输入凭证字，如 记 / 收 / 付 / 转' },
    { key: 'name', label: '名称', required: true, placeholder: '请输入凭证字名称' },
    { key: 'digits', label: '位数', kind: 'number', defaultValue: '4', placeholder: '请输入编号位数' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }],
    },
  ],
};

export default function WimoorFinanceVoucherTypePage() {
  return <MasterDataWorkbench config={config} />;
}
