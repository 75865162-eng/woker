'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「财务 → 配置 → 财务币别」功能迁移。
 * 源组件：finance/currency/index.vue
 * 还原交互：搜索(币种名称) / 新增 / 修改 / 删除 / 导出 / 同步汇率；字段：币种代码、名称、符号、汇率、精度、是否本位币、自动同步汇率。
 * 注：「同步汇率」为外部汇率服务动作，本项目不臆造汇率，仅保留字段与 CRUD 交互。
 */
const yesNo = [{ value: '1', label: '是' }, { value: '0', label: '否' }];
const config: MasterDataWorkbenchConfig = {
  kind: 'finance.currency',
  title: '财务币别',
  subtitle: 'WIMOOR 财务币别迁移：币种代码/名称/符号/精度/汇率/本位币/自动同步汇率',
  addLabel: '新增币别',
  searchPlaceholder: '请输入币种名称',
  columns: [
    { key: 'code', label: '币种', width: 120 },
    { key: 'name', label: '名称', width: 160 },
    { key: 'symbol', label: '符号', width: 90 },
    { key: 'rate', label: '汇率', width: 110, numeric: true },
    { key: 'precision', label: '精度', width: 90, numeric: true },
    {
      key: 'islocal', label: '是否本位币', width: 120,
      render: (row) => <span>{String(row.islocal) === '1' || row.islocal === true ? '是' : '否'}</span>,
    },
    {
      key: 'isauto', label: '自动同步汇率', width: 130,
      render: (row) => <span>{String(row.isauto) === '1' || row.isauto === true ? '是' : '否'}</span>,
    },
  ],
  fields: [
    { key: 'code', label: '币种代码', required: true, placeholder: '请输入币种代码，如 CNY / USD' },
    { key: 'name', label: '币种名称', required: true, placeholder: '请输入币种名称' },
    { key: 'symbol', label: '币种符号', placeholder: '请输入符号，如 ¥ / $' },
    { key: 'rate', label: '汇率', kind: 'number', placeholder: '请输入币种汇率' },
    { key: 'precision', label: '小数精度', kind: 'number', defaultValue: '2', placeholder: '请输入小数位数' },
    { key: 'islocal', label: '是否本位币', kind: 'select', defaultValue: '0', options: yesNo },
    { key: 'isauto', label: '自动同步汇率', kind: 'select', defaultValue: '0', options: yesNo },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }],
    },
  ],
};

export default function WimoorFinanceCurrencyPage() {
  return <MasterDataWorkbench config={config} />;
}
