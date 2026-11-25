'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 物流海关 → 海关报价」功能迁移。
 * 源组件：amazon/listing/product_customs/index.vue
 * 还原交互：仅支持英国提示 / 搜索·取消·重置 / 指数过滤 / 添加·清空条件 /
 *          修改申报比例 / 导出 / 确认；
 *          筛选类型(SKU·同级SKU·本地SKU·ASIN·同级ASIN·父ASIN) / 状态(未隐藏·隐藏·失效) /
 *          数据字段·符号·数值筛选条件 / 产品分类·产品名称·产品标签·配送方式·销量·备注。
 * 说明：源分析未给出表格列，列与字段依据源 Vue 表单标签还原。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.customs',
  title: '海关报价',
  subtitle: 'WIMOOR 海关报价功能迁移（仅支持英国）：申报比例、隐藏状态与指数过滤条件（用户显式创建才有数据）',
  addLabel: '新增海关报价',
  searchPlaceholder: 'SKU/ASIN/产品名称',
  columns: [
    { key: 'sku', label: 'SKU', width: 150 },
    { key: 'asin', label: 'ASIN', width: 150 },
    { key: 'name', label: '产品名称', width: 200 },
    { key: 'category', label: '产品分类', width: 140 },
    { key: 'ratio', label: '申报比例', width: 120, numeric: true },
    {
      key: 'status', label: '状态', width: 110,
      render: (row) => <span className={row.status === 'ACTIVE' ? 'text-success-ink' : 'text-muted'}>{String(row.status ?? 'ACTIVE') === 'ACTIVE' ? '未隐藏' : String(row.status)}</span>,
    },
    { key: 'remark', label: '备注', width: 200 },
  ],
  fields: [
    { key: 'code', label: '编码', required: true, placeholder: '请输入编码' },
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入SKU' },
    { key: 'asin', label: 'ASIN', placeholder: '请输入ASIN' },
    { key: 'parentasin', label: '父ASIN', placeholder: '请输入父ASIN' },
    { key: 'name', label: '产品名称', placeholder: '请输入产品名称' },
    { key: 'category', label: '产品分类', placeholder: '请输入产品分类' },
    { key: 'productlabel', label: '产品标签', placeholder: '请输入产品标签' },
    { key: 'delivery', label: '配送方式', placeholder: '请选择配送方式' },
    { key: 'ratio', label: '申报比例', kind: 'number', placeholder: '用%时请输入小数，如 0.15' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [
        { value: 'ACTIVE', label: '未隐藏' },
        { value: 'HIDDEN', label: '隐藏' },
        { value: 'INVALID', label: '失效' },
      ],
    },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'searchType', label: '筛选类型', kind: 'select', defaultValue: 'SKU',
      options: [
        { value: 'SKU', label: 'SKU' }, { value: 'SAME_SKU', label: '同级SKU' },
        { value: 'LOCAL_SKU', label: '本地SKU' }, { value: 'ASIN', label: 'ASIN' },
        { value: 'SAME_ASIN', label: '同级ASIN' }, { value: 'PARENT_ASIN', label: '父ASIN' },
        { value: 'ALL', label: '不限' },
      ],
    },
    { key: 'status', label: '显示状态', kind: 'select', defaultValue: '',
      options: [
        { value: '', label: '不限' }, { value: 'ACTIVE', label: '未隐藏' },
        { value: 'HIDDEN', label: '隐藏' }, { value: 'INVALID', label: '失效' },
      ],
    },
    { key: 'dataField', label: '数据字段', placeholder: '请选择数据字段' },
    { key: 'symbol', label: '符号', placeholder: '请选择符号' },
    { key: 'value', label: '数值', placeholder: '请输入数值，用%时请输入小数' },
  ],
};

export default function WimoorShipmentCustomsPage() {
  return <MasterDataWorkbench config={config} />;
}
