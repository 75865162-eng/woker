'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 工具 → 文件资源」功能迁移。
 * 源组件：sys/fileuser/index.vue
 * 还原交互：文件名搜索 / 预览 / 打开 / 复制链接(文件地址) / 重命名(编辑) / 删除(停用) / 分页。
 * 说明：系统工具类页面，通用组件以列表 + 文件地址字段承载；取消全部、确定等批量弹窗交互不在通用组件范围内。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.fileResource',
  title: '文件资源',
  subtitle: 'WIMOOR 文件资源功能迁移：文件名、上传时间、预览与文件地址交互（用户显式创建才有数据）',
  addLabel: '上传文件',
  searchPlaceholder: '输入文件名搜索...',
  columns: [
    { key: 'url', label: '预览', width: 90, render: (row) => row.url
      ? <a href={String(row.url)} target="_blank" rel="noreferrer" className="text-primary-ink">预览</a>
      : <span className="text-muted">—</span> },
    { key: 'name', label: '文件名', width: 260 },
    { key: 'createtime', label: '上传时间', width: 180 },
  ],
  fields: [
    { key: 'code', label: '文件编码', required: true, placeholder: '请输入文件编码' },
    { key: 'name', label: '文件名', required: true, placeholder: '请输入文件名' },
    { key: 'url', label: '文件地址', placeholder: '请输入文件链接地址' },
    { key: 'createtime', label: '上传时间', kind: 'date' },
  ],
};

export default function WimoorFileResourcesPage() {
  return <MasterDataWorkbench config={config} />;
}
