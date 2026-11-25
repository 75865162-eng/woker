'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「仓库 → 基础信息 → 仓库列表（仓位）」功能迁移。
 * 源组件：erp/warehouse/base/index.vue + components/childrenlist.vue + components/edit.vue
 * 还原交互：正品仓/测试仓/废品仓切换 / 未删除-已删除切换 / 仓位名称搜索 / 添加仓位 / 编辑 /
 *          删除与恢复 / 设为默认 / 支持负数 / 排序号 / 地址 / 国家 / 店铺 / 收货地址 / 备注 / 分页。
 */
const yesNo = [{ value: '1', label: '是' }, { value: '0', label: '否' }];
const warehouseTypes = [
  { value: 'self_usable', label: '正品仓' },
  { value: 'self_test', label: '测试仓' },
  { value: 'self_unusable', label: '废品仓' },
  { value: 'oversea_usable', label: '本地海外仓' },
];
const config: MasterDataWorkbenchConfig = {
  kind: 'warehouse.base',
  title: '仓库列表',
  subtitle: 'WIMOOR 仓库列表迁移：仓位编码/名称/类型/地址/排序/默认仓位/库存支持负数完整交互（用户显式创建才有数据）',
  addLabel: '添加仓位',
  searchPlaceholder: '仓位名称',
  extraFilters: [
    { key: 'ftype', label: '仓库类型', kind: 'select', options: warehouseTypes, defaultValue: 'self_usable' },
    { key: 'status', label: '删除状态', kind: 'select',
      options: [{ value: 'ACTIVE', label: '未删除' }, { value: 'INACTIVE', label: '已删除' }],
    },
  ],
  columns: [
    { key: 'code', label: '仓位编码', width: 130 },
    {
      key: 'name', label: '仓位名称', width: 240,
      render: (row) => (
        <span className="flex items-center gap-2">
          {String(row.name ?? '—')}
          {row.isdefault === '1' || row.isdefault === true
            ? <span className="rounded border border-warning px-1 text-xs text-warning-ink">默认仓位</span> : null}
        </span>
      ),
    },
    { key: 'ftype', label: '仓库类型', width: 130 },
    {
      key: 'ishungry', label: '支持负数', width: 90,
      render: (row) => <span>{row.ishungry === '1' || row.ishungry === true ? '是' : '否'}</span>,
    },
    { key: 'addressid', label: '仓库地址', width: 160 },
    { key: 'country', label: '国家', width: 110 },
    { key: 'groupName', label: '店铺', width: 130 },
    { key: 'sortOrder', label: '排序号', width: 90, numeric: true },
    { key: 'remark', label: '备注', width: 180 },
    { key: 'operator', label: '操作人', width: 100 },
    { key: 'opttime', label: '操作时间', width: 150 },
  ],
  fields: [
    { key: 'parentCode', label: '所属仓库', placeholder: '请选择所属仓库（父级）' },
    { key: 'code', label: '仓位编码', required: true, placeholder: '请输入仓位编码（系统流水号）' },
    { key: 'name', label: '仓位名称', required: true, placeholder: '建议包含仓库分组名称作为前缀' },
    { key: 'ftype', label: '仓库类型', kind: 'select', defaultValue: 'self_usable', options: warehouseTypes },
    { key: 'addressid', label: '地址', placeholder: '请选择仓位地址（仅用于库位绑定）' },
    { key: 'sortOrder', label: '排序号', kind: 'number', defaultValue: '0' },
    { key: 'country', label: '国家', placeholder: '海外仓必填，请输入国家代码' },
    { key: 'groupid', label: '店铺', placeholder: '海外仓可选，请输入店铺ID' },
    { key: 'ishungry', label: '库存支持负数', kind: 'select', defaultValue: '0', options: yesNo },
    { key: 'isdefault', label: '默认仓位', kind: 'select', defaultValue: '0', options: yesNo },
    { key: 'address', label: '收货地址', placeholder: '请输入收货地址' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '未删除' }, { value: 'INACTIVE', label: '已删除' }],
    },
  ],
};

export default function WimoorWarehouseBasePage() {
  return <MasterDataWorkbench config={config} />;
}
