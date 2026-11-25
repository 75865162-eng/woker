'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 工具 → 团队公告（笔记）」功能迁移。
 * 源组件：sys/notepad/index.vue
 * 还原交互：搜索(标题/SKU/内容 三种搜索维度) / 新建笔记 / 保存笔记 / 绑定SKU / 删除 / 分页。
 * 注：name 对应 Vue 的 notepad.title，保证通用组件按标题搜索；code 为框架唯一键。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.notice',
  title: '团队公告',
  subtitle: 'WIMOOR 团队公告（笔记）功能迁移：标题、关联SKU、内容完整交互（用户显式创建才有数据）',
  addLabel: '新建笔记',
  searchPlaceholder: '搜索笔记...',
  columns: [
    { key: 'name', label: '标题', width: 220 },
    { key: 'sku', label: '关联SKU', width: 160 },
    { key: 'content', label: '内容' },
    { key: 'opttime', label: '操作时间', width: 160 },
  ],
  fields: [
    { key: 'code', label: '笔记编码', required: true, placeholder: '请输入笔记编码' },
    { key: 'name', label: '输入笔记标题...', required: true, placeholder: '输入笔记标题...' },
    { key: 'sku', label: '关联SKU', placeholder: '请输入SKU' },
    { key: 'content', label: '笔记内容', placeholder: '请输入笔记内容...' },
  ],
  extraFilters: [
    { key: 'searchtype', label: '搜索维度', kind: 'select', defaultValue: 'title',
      options: [{ value: 'title', label: '标题' }, { value: 'sku', label: 'SKU' }, { value: 'content', label: '内容' }],
    },
  ],
};

export default function WimoorNoticesPage() {
  return <MasterDataWorkbench config={config} />;
}
