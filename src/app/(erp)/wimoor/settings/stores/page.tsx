'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「设置 → 店铺管理」功能迁移。
 * 源组件：amazon/storeAuth/index.vue
 * 还原交互：店铺授权确认；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'settings.store',
  title: '店铺管理',
  subtitle: 'WIMOOR 店铺管理功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '店铺名称', width: 130 },
    { key: 'marketplace', label: '站点', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.marketplace; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'name', label: '店铺名称', kind: 'text' },
    { key: 'marketplace', label: '站点', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
