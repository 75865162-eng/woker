'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 文档API」功能迁移。
 * 源组件：sys/swagger/index.vue
 * 还原交互：API文档索引；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.api-doc',
  title: '文档API',
  subtitle: 'WIMOOR 文档API功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '接口名称', width: 130 },
    { key: 'code', label: '路径', width: 130 },
    { key: 'method', label: '方法', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.method; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
  ],
  fields: [
    { key: 'name', label: '接口名称', kind: 'text' },
    { key: 'code', label: '路径', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
