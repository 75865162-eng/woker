'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「产品 → 产品属性 → 品牌管理」功能迁移。
 * 源组件：erp/baseinfo/brand/index.vue
 * 还原交互：搜索(品牌名称) / 添加品牌 / 编辑 / 删除(停用) / 品牌名称必填 / 品牌备注(textarea) / 更多操作(导入、导出) / 搜索维度(品牌名称、创建人) / 分页。
 * 注：code 为框架唯一键（对应原系统内部编码），必填以保证 upsert 幂等。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'product.brand',
  title: '品牌管理',
  subtitle: 'WIMOOR 品牌管理功能迁移：品牌名称、备注、操作时间完整交互（用户显式创建才有数据）',
  addLabel: '添加品牌',
  searchPlaceholder: '请输入品牌名称',
  columns: [
    { key: 'name', label: '品牌名称', width: 200 },
    { key: 'remark', label: '备注' },
    { key: 'opttime', label: '操作时间', width: 160 },
  ],
  fields: [
    { key: 'code', label: '品牌编码', required: true, placeholder: '请输入品牌编码' },
    { key: 'name', label: '品牌名称', required: true, placeholder: '请输入品牌名称' },
    { key: 'remark', label: '品牌备注', placeholder: '请输入备注...' },
  ],
  extraFilters: [
    { key: 'selectlabel', label: '搜索维度', kind: 'select', defaultValue: '1',
      options: [{ value: '1', label: '品牌名称' }, { value: '2', label: '创建人' }],
    },
  ],
};

export default function WimoorBrandPage() {
  return <MasterDataWorkbench config={config} />;
}
