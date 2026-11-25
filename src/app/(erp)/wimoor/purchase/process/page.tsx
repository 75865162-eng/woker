'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「采购 → 采购管理 → 加工单」功能迁移。
 * 源组件：erp/purchase/process/index.vue
 * 还原交互：状态筛选(待加工) / 加工单编码 / 名称·SKU / 操作仓库 / 单据类型 / 加工数量 / 采购需求量
 *          / 可处理数量 / 创建人 / 操作时间 / 关联货件 / 关联采购单 / 备注 / 详情 / 下载。
 * 注：详情与下载为行级查看动作，由单据字段承载；状态流转为待加工→已加工。
 */
const STATUS: Record<string, string> = { PENDING: '待加工', PROCESSING: '加工中', DONE: '已加工' };

const config: MasterDataWorkbenchConfig = {
  kind: 'purchase.process',
  type: 'document',
  title: '加工单',
  subtitle: 'WIMOOR 加工单迁移：单号/状态/操作仓库/日期/加工数量/关联货件/关联采购单/备注完整交互',
  addLabel: '新增加工单',
  searchPlaceholder: '加工单编码/名称·SKU',
  columns: [
    { key: 'docNo', label: '加工单编码', width: 150 },
    { key: 'sku', label: '名称/SKU', width: 180 },
    { key: 'partnerCode', label: '操作仓库', width: 140 },
    { key: 'docType', label: '单据类型', width: 110 },
    { key: 'amount', label: '加工数量', width: 110, numeric: true },
    { key: 'needin', label: '采购需求量', width: 110, numeric: true },
    { key: 'hasqty', label: '可处理数量', width: 110, numeric: true },
    { key: 'creator', label: '创建人', width: 110 },
    { key: 'businessDate', label: '操作时间', width: 150 },
    { key: 'shipment', label: '关联货件', width: 140 },
    { key: 'purchaseNumbers', label: '关联采购单', width: 150 },
    { key: 'status', label: '状态', width: 100, render: (row) => <span>{STATUS[String(row.status)] ?? String(row.status ?? '—')}</span> },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '加工单编码', required: true, placeholder: '请输入加工单编码' },
    { key: 'sku', label: '名称/SKU', placeholder: '请输入名称或SKU' },
    { key: 'partnerCode', label: '操作仓库', placeholder: '请输入仓库编码/名称' },
    { key: 'docType', label: '单据类型', kind: 'select', defaultValue: 'PROCESS',
      options: [{ value: 'PROCESS', label: '加工' }, { value: 'ASSEMBLY', label: '组装' }],
    },
    { key: 'businessDate', label: '操作时间', kind: 'date' },
    { key: 'amount', label: '加工数量', kind: 'number' },
    { key: 'needin', label: '采购需求量', kind: 'number' },
    { key: 'hasqty', label: '可处理数量', kind: 'number' },
    { key: 'creator', label: '创建人', placeholder: '请输入创建人' },
    { key: 'shipment', label: '关联货件', placeholder: '请输入关联货件号' },
    { key: 'purchaseNumbers', label: '关联采购单', placeholder: '多个单号用逗号分隔' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'PENDING',
      options: [
        { value: 'PENDING', label: '待加工' }, { value: 'PROCESSING', label: '加工中' }, { value: 'DONE', label: '已加工' },
      ],
    },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'statusFilter', label: '状态', kind: 'select', defaultValue: 'PENDING',
      options: [{ value: 'PENDING', label: '待加工' }, { value: 'PROCESSING', label: '加工中' }, { value: 'DONE', label: '已加工' }],
    },
    { key: 'warehouse', label: '操作仓库', placeholder: '请输入仓库' },
    { key: 'shipmentFilter', label: '关联货件', placeholder: '请输入货件号' },
  ],
  transitions: [{ to: 'PROCESSING', label: '开始加工' }, { to: 'DONE', label: '加工完成' }],
};

export default function WimoorPurchaseProcessPage() {
  return <MasterDataWorkbench config={config} />;
}
