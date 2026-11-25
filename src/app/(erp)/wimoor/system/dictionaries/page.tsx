'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「系统 → 数据字典」功能迁移。
 * 源组件：sys/dict/index.vue
 * 还原交互：字典CRUD；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'system.dict',
  title: '数据字典',
  subtitle: 'WIMOOR 数据字典功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '字典名称', width: 130 },
    { key: 'code', label: '字典编码', width: 130 },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'name', label: '字典名称', kind: 'text' },
    { key: 'code', label: '字典编码', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
