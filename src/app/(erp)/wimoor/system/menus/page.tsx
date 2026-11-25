'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 管理菜单」功能迁移。
 * 源组件：sys/menu/index.vue
 * 还原交互：菜单CRUD；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.menu',
  title: '管理菜单',
  subtitle: 'WIMOOR 管理菜单功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '菜单名称', width: 130 },
    { key: 'code', label: '路径', width: 130 },
    { key: 'sortOrder', label: '排序', width: 130 },
  ],
  fields: [
    { key: 'name', label: '菜单名称', kind: 'text' },
    { key: 'code', label: '路径', kind: 'text' },
    { key: 'sortOrder', label: '排序', kind: 'number' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
