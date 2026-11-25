'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 公告发布」功能迁移。
 * 源组件：sys/notify/index.vue
 * 还原交互：提交/取消；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.announcement',
  title: '公告发布',
  subtitle: 'WIMOOR 公告发布功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '标题', width: 130 },
    { key: 'status', label: '状态', width: 130 },
    { key: 'publishedAt', label: '发布时间', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.publishedAt; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
  ],
  fields: [
    { key: 'name', label: '标题', kind: 'text' },
    { key: 'content', label: '内容', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
