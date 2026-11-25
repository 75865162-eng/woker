'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「设置 → 部门管理」功能迁移。
 * 源组件：sys/dept/index.vue
 * 还原交互：新增/编辑/删除/搜索/重置；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'settings.department',
  title: '部门管理',
  subtitle: 'WIMOOR 部门管理功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '部门名称', width: 130 },
    { key: 'status', label: '状态', width: 130 },
    { key: 'sortOrder', label: '显示排序', width: 130 },
  ],
  fields: [
    { key: 'name', label: '部门名称', kind: 'text' },
    { key: 'sortOrder', label: '显示排序', kind: 'number' },
    { key: 'status', label: '状态', kind: 'select', options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }] },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
