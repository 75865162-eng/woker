'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 基础产品 → 标签管理」功能迁移。
 * 源组件：sys/tag/index.vue + components/sysTags.vue
 * 还原交互：搜索(标签名称) / 新增 / 编辑 / 批量停用 / 颜色单选(5色) / 排序 / 状态 / 备注 / 分页。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.tag',
  title: '标签管理',
  subtitle: 'WIMOOR 标签管理功能迁移：标签名称、颜色、排序、状态完整交互（用户显式创建才有数据）',
  addLabel: '新增标签',
  searchPlaceholder: '标签名称',
  columns: [
    { key: 'name', label: '标签名称', width: 200 },
    {
      key: 'color', label: '标签颜色', width: 140,
      render: (row) => {
        const tone = String(row.color ?? 'info');
        const tones: Record<string, string> = { info: 'bg-muted', blue: 'bg-blue-500', success: 'bg-green-500', warning: 'bg-amber-500', danger: 'bg-red-500' };
        return <span className="inline-flex items-center gap-2"><span className={`inline-block h-3 w-3 rounded-full ${tones[tone] ?? 'bg-muted'}`} />{tone}</span>;
      },
    },
    { key: 'sortOrder', label: '排序', width: 80, numeric: true },
    { key: 'status', label: '状态', width: 90, render: (row) => <span className={row.status === 'ACTIVE' ? 'text-success-ink' : 'text-muted'}>{row.status === 'ACTIVE' ? '启用' : '停用'}</span> },
  ],
  fields: [
    { key: 'name', label: '标签名称', required: true, placeholder: '请输入标签名称' },
    { key: 'color', label: '标签颜色', kind: 'color', defaultValue: 'info',
      options: [
        { value: 'info', label: '灰' }, { value: 'blue', label: '蓝' },
        { value: 'success', label: '绿' }, { value: 'warning', label: '黄' }, { value: 'danger', label: '红' },
      ],
    },
    { key: 'sortOrder', label: '排序', kind: 'number', defaultValue: '0' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }],
    },
  ],
};

export default function WimoorTagsPage() {
  return <MasterDataWorkbench config={config} />;
}
