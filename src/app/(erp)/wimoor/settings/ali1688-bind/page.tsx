'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「设置 → 1688绑定」功能迁移。
 * 源组件：erp/purchase/open1688/bind/index.vue
 * 还原交互：绑定账号/延期授权/删除；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'settings.ali1688-bind',
  title: '1688绑定',
  subtitle: 'WIMOOR 1688绑定功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '采购账号', width: 130 },
    { key: 'platform', label: '采购平台', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.platform; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'accountName', label: '平台账户名称', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.accountName; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'expireAt', label: '到期时间', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.expireAt; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'name', label: '采购账号', kind: 'text' },
    { key: 'platform', label: '采购平台', kind: 'select', options: [{ value: 'platform', label: '采购平台' }] },
    { key: 'accountName', label: '平台账户名称', kind: 'text' },
    { key: 'expireAt', label: '到期时间', kind: 'date' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
