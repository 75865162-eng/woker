'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 发货管理 → 货件跟踪」功能迁移。
 * 源组件：erp/ship/shipment_handing/list/index.vue（Header + Table）
 * 还原交互：状态页签(全部货件/处理中/已发货/正在接收/已完成/已取消/异常单据) /
 *          店铺·国家·仓库·日期 / 承运商·物流渠道·运输方式 / 货件号搜索 / 箱规·参考号筛选 /
 *          货件号、店铺、国家、仓库、承运商、渠道、运输方式、跟踪状态列表及状态流转。
 */
const STATUS_LABELS: Record<string, string> = {
  ALL: '全部货件', PROCESSING: '处理中', SHIPPED: '已发货', RECEIVING: '正在接收',
  COMPLETED: '已完成', CANCELLED: '已取消', EXCEPTION: '异常单据',
};

const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.track',
  type: 'document',
  title: '货件跟踪',
  subtitle: 'WIMOOR 货件跟踪功能迁移：货件运输与接收状态跟踪（用户显式创建才有数据）',
  addLabel: '新增跟踪货件',
  searchPlaceholder: '请输入货件号/SKU',
  columns: [
    { key: 'docNo', label: '货件号', width: 180 },
    { key: 'trackingNo', label: '追踪号', width: 170 },
    { key: 'store', label: '店铺', width: 140 },
    { key: 'country', label: '国家', width: 110 },
    { key: 'warehouse', label: '仓库', width: 150 },
    { key: 'company', label: '承运商', width: 150 },
    { key: 'channel', label: '物流渠道', width: 150 },
    { key: 'transtype', label: '运输方式', width: 130 },
    {
      key: 'status', label: '跟踪状态', width: 130,
      render: (row) => <span className="text-muted">{STATUS_LABELS[String(row.status ?? 'PROCESSING')] ?? String(row.status ?? 'PROCESSING')}</span>,
    },
    { key: 'opttime', label: '操作时间', width: 170 },
  ],
  fields: [
    { key: 'docNo', label: '货件号', required: true, placeholder: '请输入货件号' },
    { key: 'trackingNo', label: '追踪号', placeholder: '请输入追踪号' },
    { key: 'store', label: '店铺', placeholder: '请选择店铺' },
    { key: 'country', label: '国家', placeholder: '请选择国家' },
    { key: 'warehouse', label: '仓库', placeholder: '请选择仓库' },
    { key: 'company', label: '承运商', placeholder: '请选择承运商' },
    { key: 'channel', label: '物流渠道', placeholder: '请选择物流渠道' },
    { key: 'transtype', label: '运输方式', placeholder: '请选择运输方式' },
    { key: 'fbacenter', label: 'FBA中心', placeholder: '请选择FBA中心' },
    { key: 'businessDate', label: '跟踪日期', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '跟踪状态', kind: 'select', defaultValue: 'PROCESSING',
      options: [
        { value: 'PROCESSING', label: '处理中' }, { value: 'SHIPPED', label: '已发货' },
        { value: 'RECEIVING', label: '正在接收' }, { value: 'COMPLETED', label: '已完成' },
        { value: 'CANCELLED', label: '已取消' }, { value: 'EXCEPTION', label: '异常单据' },
      ],
    },
  ],
  extraFilters: [
    { key: 'store', label: '店铺', placeholder: '请选择店铺' },
    { key: 'country', label: '国家', placeholder: '请选择国家' },
    { key: 'warehouse', label: '仓库', placeholder: '请选择仓库' },
    { key: 'company', label: '承运商', placeholder: '请选择承运商' },
    { key: 'channel', label: '物流渠道', placeholder: '请选择物流渠道' },
    { key: 'seachtype', label: '搜索类型', kind: 'select', defaultValue: 'sku',
      options: [{ value: 'sku', label: 'SKU' }, { value: 'shipment', label: '货件号' }],
    },
    { key: 'start', label: '开始日期', kind: 'date' },
    { key: 'end', label: '结束日期', kind: 'date' },
    { key: 'checkdown', label: '已下载', kind: 'select', defaultValue: '',
      options: [{ value: '', label: '不限' }, { value: 'YES', label: '是' }, { value: 'NO', label: '否' }],
    },
  ],
  transitions: [
    { to: 'SHIPPED', label: '已发货' },
    { to: 'RECEIVING', label: '正在接收' },
    { to: 'COMPLETED', label: '已完成' },
    { to: 'EXCEPTION', label: '标记异常' },
    { to: 'CANCELLED', label: '已取消' },
  ],
};

export default function WimoorShipmentTrackPage() {
  return <MasterDataWorkbench config={config} />;
}
