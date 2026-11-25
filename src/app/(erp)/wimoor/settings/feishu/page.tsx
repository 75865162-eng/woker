'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「设置 → 飞书绑定」功能迁移。
 * 源组件：sys/feishu/index.vue
 * 还原交互：保存/修改；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'settings.feishu',
  title: '飞书绑定',
  subtitle: 'WIMOOR 飞书绑定功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '应用名称', width: 130 },
    { key: 'appId', label: 'App ID', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.appId; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'name', label: '应用名称', kind: 'text' },
    { key: 'appId', label: 'App ID', kind: 'text' },
    { key: 'appSecret', label: 'App Secret', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
