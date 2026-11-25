'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → FBA费设置」功能迁移。
 * 源组件：amazon/profit/fbafee/index.vue
 * 还原交互：FBA费用参数；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.fba-fee',
  title: 'FBA费设置',
  subtitle: 'WIMOOR FBA费设置功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '名称', width: 130 },
    { key: 'code', label: '费用项', width: 130 },
    { key: 'value', label: '值', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.value; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
  ],
  fields: [
    { key: 'name', label: '名称', kind: 'text' },
    { key: 'code', label: '费用项', kind: 'text' },
    { key: 'value', label: '值', kind: 'number' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
