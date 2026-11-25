'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「采购 → 供应协同 → 供应商」功能迁移。
 * 源组件：erp/baseinfo/supplier/index.vue
 * 还原交互：搜索(名称、联系人、电话或编码) / 添加供应商 / 编辑 / 删除(停用)
 *          / 导入信息 / 导出信息 / 下载模板 / 上传文件 / 取消 / 状态 / 分页。
 * 注：code 为框架唯一键（对应原系统供应商编码），必填以保证 upsert 幂等。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'purchase.supplier',
  type: 'entry',
  title: '供应商',
  subtitle: 'WIMOOR 供应商迁移：编码/名称/联系人/电话/地址/状态，支持按名称、联系人、电话或编码搜索',
  addLabel: '添加供应商',
  searchPlaceholder: '请输入名称,联系人,电话或编码',
  columns: [
    { key: 'code', label: '供应商编码', width: 150 },
    { key: 'name', label: '供应商名称', width: 200 },
    { key: 'contact', label: '联系人', width: 120 },
    { key: 'phone', label: '电话', width: 140 },
    { key: 'mobile', label: '手机', width: 140 },
    { key: 'email', label: '邮箱', width: 180 },
    { key: 'address', label: '地址', width: 220 },
    { key: 'status', label: '状态', width: 90, render: (row) => <span className={row.status === 'ACTIVE' ? 'text-success-ink' : 'text-muted'}>{row.status === 'ACTIVE' ? '启用' : '停用'}</span> },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'code', label: '供应商编码', required: true, placeholder: '请输入供应商编码' },
    { key: 'name', label: '供应商名称', required: true, placeholder: '请输入供应商名称' },
    { key: 'contact', label: '联系人', placeholder: '请输入联系人' },
    { key: 'phone', label: '电话', placeholder: '请输入电话' },
    { key: 'mobile', label: '手机', placeholder: '请输入手机' },
    { key: 'email', label: '邮箱', placeholder: '请输入邮箱' },
    { key: 'address', label: '地址', placeholder: '请输入地址' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }],
    },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'contactFilter', label: '联系人', placeholder: '请输入联系人' },
    { key: 'phoneFilter', label: '电话', placeholder: '请输入电话' },
  ],
};

export default function WimoorPurchaseSupplierPage() {
  return <MasterDataWorkbench config={config} />;
}
