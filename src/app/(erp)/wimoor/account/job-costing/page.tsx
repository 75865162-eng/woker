'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「账目 → 本地账目 → 批次成本」功能迁移（新增页，单据型）。
 * 源组件：amazon/payment/jobCosting/index.vue + components/table.vue。
 * 还原交互：店铺/负责人/日期/状态筛选、搜索类型(平台SKU/单据号/货件号)、
 * 12 个表格列（SKU/发货日期/接收日期/状态/单据号/货件号/发出-接收-扣除数量/采购成本/头程成本）、
 * 「修改接收日期」弹窗字段(选择类型 具体日期/增加天数、选择日期、增加天数)、重置成本/导出；
 * 以 document 存储：docNo=单据号、businessDate=发货日期、status=扣减状态，扩展字段存 payload。
 */
type Row = Record<string, unknown>;
function ext(row: Row): Record<string, unknown> {
  const p = row.payload;
  if (!p) return {};
  if (typeof p === 'string') {
    try { return JSON.parse(p) as Record<string, unknown>; } catch { return {}; }
  }
  return p as Record<string, unknown>;
}
const STATUS: Record<string, string> = { '1': '未开始', '2': '扣减中', '3': '已扣完' };
const config: MasterDataWorkbenchConfig = {
  kind: 'account.jobCosting',
  type: 'document',
  title: '批次成本',
  subtitle: 'WIMOOR 批次成本迁移：单据号、SKU、发货/接收日期、扣减状态、数量与采购/头程成本完整交互（单据由用户显式创建）。',
  addLabel: '新增批次成本单',
  searchPlaceholder: '请输入',
  columns: [
    {
      key: 'sku', label: '平台SKU', width: 220,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(ext(row).sku ?? '') || '—'}</span>
          <span className="text-muted">{String(ext(row).groupname ?? '')} - {String(ext(row).marketname ?? '')} {String(ext(row).name ?? '')}</span>
        </span>
      ),
    },
    { key: 'businessDate', label: '发货日期', width: 130 },
    { key: 'ReceivedDate', label: '接收日期', width: 130, render: (row) => <span>{String(ext(row).ReceivedDate ?? '') || '—'}</span> },
    {
      key: 'status', label: '状态', width: 140,
      render: (row) => (
        <span className="flex flex-col">
          <span>{STATUS[String(row.status)] ?? (row.status ? String(row.status) : '未处理')}</span>
          <span className="text-muted">货件状态：{String(ext(row).shipmentstatus ?? '')}</span>
        </span>
      ),
    },
    { key: 'docNo', label: '单据号', width: 170 },
    { key: 'shipmentid', label: '货件号', width: 140, render: (row) => <span>{String(ext(row).shipmentid ?? '') || '—'}</span> },
    { key: 'QuantityShipped', label: '发出数量', width: 110, numeric: true, render: (row) => <span>{String(ext(row).QuantityShipped ?? '') || '—'}</span> },
    { key: 'QuantityReceived', label: '接收数量', width: 110, numeric: true, render: (row) => <span>{String(ext(row).QuantityReceived ?? '') || '—'}</span> },
    {
      key: 'QuantityReceivedSub', label: '扣除数量', width: 140, numeric: true,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(ext(row).QuantityReceivedSub ?? '') || '—'}</span>
          <span className="text-muted">剩余量:{String(ext(row).QuantityReceivedBalance ?? '')}</span>
        </span>
      ),
    },
    {
      key: 'totalcost', label: '采购成本', width: 140, numeric: true,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(ext(row).totalcost ?? '') || '—'}</span>
          <span className="text-muted">单件成本:{String(ext(row).unitcost ?? '')}</span>
        </span>
      ),
    },
    {
      key: 'totaltransfee', label: '头程成本', width: 140, numeric: true,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(ext(row).totaltransfee ?? '') || '—'}</span>
          <span className="text-muted">单件成本:{String(ext(row).unittransfee ?? '')}</span>
        </span>
      ),
    },
  ],
  fields: [
    { key: 'docNo', label: '单据号', required: true, placeholder: '请输入单据号' },
    { key: 'sku', label: '平台SKU', required: true, placeholder: '请输入平台SKU' },
    { key: 'groupname', label: '店铺', placeholder: '请输入店铺' },
    { key: 'marketname', label: '站点', placeholder: '请输入站点' },
    { key: 'name', label: '产品名称', placeholder: '请输入产品名称' },
    { key: 'businessDate', label: '发货日期', kind: 'date' },
    { key: 'ReceivedDate', label: '接收日期', kind: 'date' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: '1',
      options: [
        { value: '1', label: '未开始' }, { value: '2', label: '扣减中' }, { value: '3', label: '已扣完' },
      ] },
    { key: 'shipmentstatus', label: '货件状态', placeholder: '请输入货件状态' },
    { key: 'shipmentid', label: '货件号', placeholder: '请输入货件号' },
    { key: 'QuantityShipped', label: '发出数量', kind: 'number' },
    { key: 'QuantityReceived', label: '接收数量', kind: 'number' },
    { key: 'QuantityReceivedSub', label: '扣除数量', kind: 'number' },
    { key: 'QuantityReceivedBalance', label: '剩余量', kind: 'number' },
    { key: 'totalcost', label: '采购成本', kind: 'number' },
    { key: 'unitcost', label: '采购单件成本', kind: 'number' },
    { key: 'totaltransfee', label: '头程成本', kind: 'number' },
    { key: 'unittransfee', label: '头程单件成本', kind: 'number' },
    { key: 'ftype', label: '选择类型', kind: 'select', defaultValue: 'normal',
      options: [{ value: 'normal', label: '具体日期' }, { value: 'day', label: '增加天数(根据当前日期)' }] },
    { key: 'date', label: '选择日期', kind: 'date' },
    { key: 'day', label: '增加天数', kind: 'number', defaultValue: '7' },
  ],
  extraFilters: [
    { key: 'status', label: '状态', kind: 'select',
      options: [
        { value: '', label: '全部状态' }, { value: '1', label: '未开始' },
        { value: '2', label: '扣减中' }, { value: '3', label: '已扣完' },
      ] },
    { key: 'searchType', label: '搜索类型', kind: 'select', defaultValue: 'sku',
      options: [
        { value: 'sku', label: '平台SKU' }, { value: 'number', label: '单据号' }, { value: 'shipmentid', label: '货件号' },
      ] },
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'toDate', label: '结束日期', kind: 'date' },
    { key: 'owner', label: '负责人', placeholder: '请输入负责人' },
  ],
};

export default function WimoorAccountJobCostingPage() {
  return <MasterDataWorkbench config={config} />;
}
