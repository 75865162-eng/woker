'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 代码生成」功能迁移。
 * 源组件：sys/gen/index.vue
 * 还原交互：搜索/生成/导入；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.codegen',
  title: '代码生成',
  subtitle: 'WIMOOR 代码生成功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'code', label: '序号', width: 130 },
    { key: 'name', label: '表名称', width: 130 },
    { key: 'desc', label: '表描述', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.desc; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'entity', label: '实体', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.entity; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
  ],
  fields: [
    { key: 'name', label: '表名称', kind: 'text' },
    { key: 'desc', label: '表描述', kind: 'text' },
    { key: 'entity', label: '实体', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
