'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「仓库 → 基础信息 → 库位列表」功能迁移。
 * 源组件：erp/warehouse/shelf/create/index.vue + components/shelf_dialog.vue + components/shelf_card.vue
 * 还原交互：左侧库位树 / 添加库位 / 批量删除 / 二维码下载 / 详情 / 编辑 / 上架 / 下架 /
 *          库位名称([排,行,列,格] 或 [区,架,层,盒]) / 起始编码 / 长宽高规格(cm) / 库位数量 / 含子库位。
 * 说明：树形层级以 parentCode 表达，二维码/上下架为外部动作，本项目仅保留字段与 CRUD 交互。
 */
const yesNo = [{ value: '1', label: '是' }, { value: '0', label: '否' }];
const spec = (row: Record<string, unknown>) => {
  const { length, width, height } = row;
  if (!length && !width && !height) return '无';
  return `${String(length ?? '')}×${String(width ?? '')}×${String(height ?? '')} cm`;
};
const config: MasterDataWorkbenchConfig = {
  kind: 'warehouse.shelf',
  title: '库位列表',
  subtitle: 'WIMOOR 库位列表迁移：父级库位/编码/名称/规格/数量/上下架，库位由用户显式创建',
  addLabel: '添加库位',
  searchPlaceholder: '库位名称或编码',
  extraFilters: [
    { key: 'allchildren', label: '含子库位', kind: 'select', defaultValue: '1', options: yesNo },
    { key: 'status', label: '状态', kind: 'select',
      options: [{ value: 'ACTIVE', label: '正常' }, { value: 'INACTIVE', label: '已删除' }],
    },
  ],
  columns: [
    { key: 'code', label: '库位编码', width: 130 },
    { key: 'name', label: '库位名称', width: 200 },
    { key: 'specification', label: '规格', width: 180, render: (row) => <span>{spec(row)}</span> },
    { key: 'quantity', label: '库位数量', width: 110, numeric: true },
    { key: 'usedSize', label: '已用容量', width: 130 },
    { key: 'skuNum', label: 'SKU数量', width: 110, numeric: true },
    { key: 'remark', label: '备注', width: 160 },
    { key: 'operator', label: '操作人', width: 100 },
    { key: 'opttime', label: '操作时间', width: 150 },
  ],
  fields: [
    { key: 'parentCode', label: '父级库位', placeholder: '请选择父级（仓库/上级库位）' },
    { key: 'code', label: '起始编码', required: true, placeholder: '请输入起始编码' },
    { key: 'name', label: '库位名称', required: true, placeholder: '[排,行,列,格],[区,架,层,盒]' },
    { key: 'length', label: '长(cm)', kind: 'number', placeholder: '长' },
    { key: 'width', label: '宽(cm)', kind: 'number', placeholder: '宽' },
    { key: 'height', label: '高(cm)', kind: 'number', placeholder: '高' },
    { key: 'quantity', label: '库位数量', kind: 'number', placeholder: '请输入库位数量' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '正常' }, { value: 'INACTIVE', label: '已删除' }],
    },
  ],
};

export default function WimoorWarehouseShelfPage() {
  return <MasterDataWorkbench config={config} />;
}
