'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → FBA中心配置」功能迁移。
 * 源组件：amazon/inbound/fbacenter.vue
 * 还原交互：添加/修改/保存/删除；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.fba-center',
  title: 'FBA中心配置',
  subtitle: 'WIMOOR FBA中心配置功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'code', label: 'Code', width: 130 },
    { key: 'country', label: '国家', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.country; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'name', label: '地址名称', width: 130 },
    { key: 'city', label: '城市', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.city; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
  ],
  fields: [
    { key: 'code', label: 'Code', kind: 'text' },
    { key: 'country', label: '国家', kind: 'text' },
    { key: 'name', label: '地址名称', kind: 'text' },
    { key: 'city', label: '城市', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
