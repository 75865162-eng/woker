'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「设置 → 物流绑定」功能迁移。
 * 源组件：erp/thirdparty/index.vue
 * 还原交互：添加API/禁用/启用/编辑；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'settings.logistics-bind',
  title: '物流绑定',
  subtitle: 'WIMOOR 物流绑定功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '名称', width: 130 },
    { key: 'systemName', label: '系统名称', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.systemName; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'authInfo', label: '授权信息', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.authInfo; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'api', label: 'API', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.api; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
  ],
  fields: [
    { key: 'name', label: '名称', kind: 'text' },
    { key: 'systemName', label: '系统名称', kind: 'text' },
    { key: 'authInfo', label: '授权信息', kind: 'text' },
    { key: 'api', label: 'API', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
