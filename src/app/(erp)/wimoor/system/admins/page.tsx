'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 管理员号」功能迁移。
 * 源组件：sys/subUser/index.vue
 * 还原交互：添加用户/重置/启用/停用；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.admin',
  title: '管理员号',
  subtitle: 'WIMOOR 管理员号功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '用户名', width: 130 },
    { key: 'code', label: '登录账号', width: 130 },
    { key: 'status', label: '状态', width: 130 },
    { key: 'dept', label: '部门', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.dept; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
  ],
  fields: [
    { key: 'name', label: '用户名', kind: 'text' },
    { key: 'code', label: '登录账号', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
