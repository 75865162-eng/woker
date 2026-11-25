'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 套餐管理」功能迁移。
 * 源组件：sys/tariffpackages/index.vue
 * 还原交互：添加新套餐/编辑/删除；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.package',
  title: '套餐管理',
  subtitle: 'WIMOOR 套餐管理功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '名称', width: 130 },
    { key: 'limit', label: '数量上限', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.limit; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'stores', label: '绑定店铺', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.stores; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'name', label: '名称', kind: 'text' },
    { key: 'limit', label: '数量上限', kind: 'number' },
    { key: 'stores', label: '绑定店铺', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
