'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 客户订单」功能迁移。
 * 源组件：sys/customer/order/index.vue
 * 还原交互：搜索/添加新订单/编辑；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.client-order',
  title: '客户订单',
  subtitle: 'WIMOOR 客户订单功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'document',
  columns: [
    { key: 'docNo', label: '商户订单号', width: 130 },
    { key: 'company', label: '公司名称', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.company; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'name', label: '订单名称', width: 130 },
    { key: 'package', label: '套餐名称', width: 140, render: (row) => { const v = (row.payload as Record<string, unknown>)?.package; return v == null || v === '' ? <span className="text-muted">—</span> : <>{String(v)}</>; } },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'docNo', label: '订单号', kind: 'text' },
    { key: 'company', label: '公司名称', kind: 'text' },
    { key: 'package', label: '套餐名称', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
