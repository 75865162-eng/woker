'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 系统任务」功能迁移。
 * 源组件：sys/task/index.vue
 * 还原交互：添加新任务/重载/编辑/暂停；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.task',
  title: '系统任务',
  subtitle: 'WIMOOR 系统任务功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '名称', width: 130 },
    { key: 'schedule', label: '执行时间', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.schedule; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'desc', label: '描述', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.desc; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'name', label: '名称', kind: 'text' },
    { key: 'schedule', label: '执行时间', kind: 'text' },
    { key: 'desc', label: '描述', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
