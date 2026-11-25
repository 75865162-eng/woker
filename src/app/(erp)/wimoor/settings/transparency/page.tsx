'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「设置 → 透明计划授权」功能迁移。
 * 源组件：amazon/transparency/auth/index.vue
 * 还原交互：新增/删除/确认；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'settings.transparency',
  title: '透明计划授权',
  subtitle: 'WIMOOR 透明计划授权功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '名称', width: 130 },
    { key: 'clientId', label: 'Client Id', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.clientId; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'clientSecret', label: 'Client Secret', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.clientSecret; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'createdAt', label: '创建时间', width: 160 },
  ],
  fields: [
    { key: 'name', label: '名称', kind: 'text' },
    { key: 'clientId', label: 'Client Id', kind: 'text' },
    { key: 'clientSecret', label: 'Client Secret', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
