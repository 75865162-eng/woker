'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 发货管理 → FBA发货规划」功能迁移。
 * 源组件：erp/ship/ship_plan/index.vue
 * 还原交互：方案切换(系统默认/运营中心转运/运营中心处理中/正在发货/待接收/正在接收) / 已使用过滤 /
 *          图片 / 名称·SKU / 报表 / 发货需求量 / 实际发货总量 / 可用库存 / 公告 / 操作 / 确定·关闭。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.shipPlan',
  type: 'document',
  title: 'FBA发货规划',
  subtitle: 'WIMOOR FBA发货规划功能迁移：发货需求量、实际发货总量、可用库存与方案切换（用户显式创建才有数据）',
  addLabel: '新增发货规划',
  searchPlaceholder: '名称/SKU',
  columns: [
    { key: 'image', label: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="产品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'sku', label: '名称/SKU', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.name ?? '—')}</span><span className="text-muted">{String(row.sku ?? '')}</span></span>
    ) },
    { key: 'report', label: '报表', width: 120 },
    { key: 'marketneedship', label: '发货需求量', width: 120, numeric: true },
    { key: 'amount', label: '实际发货总量', width: 130, numeric: true },
    { key: 'allquantity', label: '可用库存', width: 110, numeric: true },
    { key: 'notice', label: '公告', width: 200 },
    { key: 'planType', label: '方案', width: 160 },
  ],
  fields: [
    { key: 'docNo', label: '规划单号', required: true, placeholder: '请输入规划单号' },
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入SKU' },
    { key: 'name', label: '名称', placeholder: '请输入产品名称' },
    { key: 'image', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'marketneedship', label: '发货需求量', kind: 'number', defaultValue: '0' },
    { key: 'amount', label: '实际发货总量', kind: 'number', defaultValue: '0' },
    { key: 'allquantity', label: '可用库存', kind: 'number', defaultValue: '0' },
    { key: 'report', label: '报表', placeholder: '请输入报表信息' },
    { key: 'notice', label: '公告', placeholder: '请输入公告' },
    { key: 'planType', label: '方案', kind: 'select', defaultValue: 'DEFAULT',
      options: [
        { value: 'DEFAULT', label: '系统默认' },
        { value: 'TRANSFER', label: '运营中心转运' },
        { value: 'PROCESSING', label: '运营中心处理中' },
        { value: 'SHIPPING', label: '正在发货' },
        { value: 'PENDING_RECEIVE', label: '待接收' },
        { value: 'RECEIVING', label: '正在接收' },
      ],
    },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'DRAFT',
      options: [{ value: 'DRAFT', label: '草稿' }, { value: 'CONFIRMED', label: '已确定' }, { value: 'CANCELLED', label: '已关闭' }],
    },
  ],
  extraFilters: [
    { key: 'planType', label: '方案', kind: 'select', defaultValue: '',
      options: [
        { value: '', label: '(默认)' }, { value: 'TRANSFER', label: '(运营中心转运)' },
        { value: 'PROCESSING', label: '(运营中心处理中)' }, { value: 'SHIPPING', label: '(正在发货)' },
        { value: 'PENDING_RECEIVE', label: '(待接收)' }, { value: 'RECEIVING', label: '(正在接收)' },
      ],
    },
    { key: 'used', label: '使用状态', kind: 'select', defaultValue: '',
      options: [{ value: '', label: '不限' }, { value: 'USED', label: '已使用' }],
    },
  ],
  transitions: [
    { to: 'CONFIRMED', label: '确定' },
    { to: 'CANCELLED', label: '关闭' },
  ],
};

export default function WimoorShipmentShipPlanPage() {
  return <MasterDataWorkbench config={config} />;
}
