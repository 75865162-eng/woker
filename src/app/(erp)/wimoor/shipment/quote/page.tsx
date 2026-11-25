'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 物流报价 → 集中询价」功能迁移。
 * 源组件：erp/shipv2/quote/quote.vue
 * 还原交互：综合搜索(货件号/询价单号/SKU/地址/国家/店铺/备注) / 店铺·仓库·国家·订单筛选 /
 *          搜索·重置 / 箱子详情 / 产品详情 / 生成询价订单 / 批量报价·地址报价 / 提交·确认生成·关闭·删除；
 *          表格还原货件信息、状态、订单号、备注、报价、地址信息、询价人、仓库、重量、体积、SKU数量、操作时间，
 *          及箱子明细(箱子ID/长宽高/重量)与产品明细(图片/品名/SKU/材质/数量)。
 */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '草稿', SUBMITTED: '已提交', QUOTED: '已报价', CONFIRMED: '已生成订单', CANCELLED: '已关闭',
};

const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.quote',
  type: 'document',
  title: '集中询价',
  subtitle: 'WIMOOR 集中询价功能迁移：询价单、箱子与产品明细、批量报价与生成询价订单（用户显式创建才有数据）',
  addLabel: '生成询价订单',
  searchPlaceholder: '请输入货件号,询价单号,SKU,地址,国家,店铺,备注',
  columns: [
    { key: 'docNo', label: '询价单号', width: 170 },
    { key: 'shipmentid', label: '货件信息', width: 170 },
    {
      key: 'status', label: '状态', width: 120,
      render: (row) => <span className="text-muted">{STATUS_LABELS[String(row.status ?? 'DRAFT')] ?? String(row.status ?? 'DRAFT')}</span>,
    },
    { key: 'number', label: '订单号', width: 150 },
    { key: 'destination', label: '地址信息', width: 180 },
    { key: 'contact', label: '询价人', width: 120 },
    { key: 'warehouse', label: '仓库', width: 140 },
    { key: 'weight', label: '重量', width: 100, numeric: true },
    { key: 'volume', label: '体积', width: 100, numeric: true },
    { key: 'num', label: 'SKU数量', width: 100, numeric: true },
    { key: 'address', label: '地址', width: 180 },
    { key: 'remark', label: '备注', width: 180 },
    { key: 'opttime', label: '操作时间', width: 170 },
  ],
  fields: [
    { key: 'docNo', label: '询价单号', required: true, placeholder: '请输入询价单号' },
    { key: 'shipmentid', label: '货件号', placeholder: '请输入货件号' },
    { key: 'number', label: '订单号', placeholder: '请输入订单号' },
    { key: 'store', label: '店铺', placeholder: '请选择店铺' },
    { key: 'warehouse', label: '仓库', placeholder: '请选择仓库' },
    { key: 'country', label: '国家', placeholder: '请选择国家' },
    { key: 'destination', label: '地址信息', placeholder: '请输入地址信息' },
    { key: 'address', label: '地址', placeholder: '请输入地址' },
    { key: 'contact', label: '询价人', placeholder: '请输入询价人' },
    { key: 'weight', label: '重量', kind: 'number', defaultValue: '0' },
    { key: 'volume', label: '体积', kind: 'number', defaultValue: '0' },
    { key: 'num', label: 'SKU数量', kind: 'number', defaultValue: '0' },
    { key: 'boxid', label: '箱子ID', placeholder: '请输入箱子ID' },
    { key: 'length', label: '长(cm)', kind: 'number', defaultValue: '0' },
    { key: 'width', label: '宽(cm)', kind: 'number', defaultValue: '0' },
    { key: 'height', label: '高(cm)', kind: 'number', defaultValue: '0' },
    { key: 'boxweight', label: '重(kg)', kind: 'number', defaultValue: '0' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'name', label: '品名', placeholder: '请输入品名' },
    { key: 'material', label: '材质', placeholder: '请输入材质' },
    { key: 'quantity', label: '数量', kind: 'number', defaultValue: '0' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'DRAFT',
      options: [
        { value: 'DRAFT', label: '草稿' }, { value: 'SUBMITTED', label: '已提交' },
        { value: 'QUOTED', label: '已报价' }, { value: 'CONFIRMED', label: '已生成订单' },
        { value: 'CANCELLED', label: '已关闭' },
      ],
    },
  ],
  extraFilters: [
    { key: 'store', label: '店铺', placeholder: '搜索店铺' },
    { key: 'warehouse', label: '仓库', placeholder: '搜索仓库' },
    { key: 'country', label: '国家', placeholder: '搜索国家' },
    { key: 'number', label: '订单', placeholder: '搜索订单' },
    { key: 'shipmentid', label: '货件', placeholder: '搜索货件，逗号分割' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  transitions: [
    { to: 'SUBMITTED', label: '提交' },
    { to: 'QUOTED', label: '批量报价' },
    { to: 'CONFIRMED', label: '确认生成' },
    { to: 'CANCELLED', label: '关闭' },
  ],
};

export default function WimoorShipmentQuotePage() {
  return <MasterDataWorkbench config={config} />;
}
