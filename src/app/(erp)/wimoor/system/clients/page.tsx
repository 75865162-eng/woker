'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 客户管理」功能迁移。
 * 源组件：sys/customer/index.vue
 * 还原交互：查询/编辑/删除/暂停；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.client',
  title: '客户管理',
  subtitle: 'WIMOOR 客户管理功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '客户信息', width: 130 },
    { key: 'company', label: '公司名称', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.company; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'registeredAt', label: '注册时间', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.registeredAt; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'name', label: '客户信息', kind: 'text' },
    { key: 'company', label: '公司名称', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
