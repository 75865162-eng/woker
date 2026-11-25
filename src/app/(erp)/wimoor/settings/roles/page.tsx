'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「设置 → 角色权限」功能迁移。
 * 源组件：sys/ruleAuth/index.vue
 * 还原交互：角色权限配置；搜索/新增/编辑/停用/分页（不造数）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'settings.role',
  title: '角色权限',
  subtitle: 'WIMOOR 角色权限功能迁移：完整字段、下拉、状态与交互（用户显式创建才有数据）',
  addLabel: '新增',
  type: 'entry',
  columns: [
    { key: 'name', label: '角色名称', width: 130 },
    { key: 'code', label: '编码', width: 130 },
    { key: 'status', label: '状态', width: 130 },
  ],
  fields: [
    { key: 'name', label: '角色名称', kind: 'text' },
    { key: 'code', label: '编码', kind: 'text' },
    { key: 'remark', label: '权限说明', kind: 'text' },
  ],
};

export default function Page() {
  return <MasterDataWorkbench config={config} />;
}
