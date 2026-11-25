'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 数据迁移」功能迁移。
 * 源组件：sys/movedata/index.vue
 * 还原交互：数据迁移任务；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.migration',
  title: '数据迁移',
  subtitle: 'WIMOOR 数据迁移功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'document',
  columns: [
    { key: 'name', label: '任务名称', width: 130 },
    { key: 'source', label: '来源', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.source; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'target', label: '目标', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.target; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'docNo', label: '任务名称', kind: 'text' },
    { key: 'source', label: '来源', kind: 'text' },
    { key: 'target', label: '目标', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
