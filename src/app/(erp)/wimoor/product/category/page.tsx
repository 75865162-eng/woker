'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 产品属性 → 品类管理」功能迁移。
 * 源组件：erp/baseinfo/category/index.vue
 * 还原交互：搜索(品类名称) / 添加品类 / 编辑 / 删除(停用) / 品类名称必填 / 编码 / 品类备注(textarea) / 更多操作(导入、导出) / 搜索维度(品类名称、创建人) / 分页。
 * 注：code 字段对应 Vue 的编码(number)，同时作为框架 upsert 唯一键。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.category',
  title: '品类管理',
  subtitle: 'WIMOOR 品类管理功能迁移：品类名称、编码、备注、操作时间完整交互（用户显式创建才有数据）',
  addLabel: '添加品类',
  searchPlaceholder: '请输入品类名称',
  columns: [
    { key: 'name', label: '品类名称', width: 200 },
    { key: 'code', label: '编码', width: 140 },
    { key: 'remark', label: '备注' },
    { key: 'opttime', label: '操作时间', width: 160 },
  ],
  fields: [
    { key: 'code', label: '编码', required: true, placeholder: '请输入品类编码' },
    { key: 'name', label: '品类名称', required: true, placeholder: '请输入品类名称' },
    { key: 'remark', label: '品类备注', placeholder: '请输入备注...' },
  ],
  extraFilters: [
    { key: 'selectlabel', label: '搜索维度', kind: 'select', defaultValue: '1',
      options: [{ value: '1', label: '品类名称' }, { value: '2', label: '创建人' }],
    },
  ],
};

export default function WimoorCategoryPage() {
  return <MasterDataWorkbench config={config} />;
}
