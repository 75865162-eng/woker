'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 在线客户」功能迁移。
 * 源组件：sys/online/index.vue
 * 还原交互：搜索/重置/强退；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.online',
  title: '在线客户',
  subtitle: 'WIMOOR 在线客户功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'code', label: '序号', width: 130 },
    { key: 'sessionId', label: '会话编号', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.sessionId; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'name', label: '登录名称', width: 130 },
    { key: 'host', label: '主机', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.host; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
  ],
  fields: [
    { key: 'sessionId', label: '会话编号', kind: 'text' },
    { key: 'name', label: '登录名称', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
