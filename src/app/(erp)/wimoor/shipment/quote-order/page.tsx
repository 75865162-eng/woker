'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 物流报价 → 报价单」功能迁移。
 * 源组件：erp/shipv2/quote/order.vue
 * 还原交互：综合搜索(询价单号/货件号/SKU/供应商/地址/国家/店铺/备注) / 日期与批次筛选 / 编码·重量·体积·总价过滤 /
 *          批量询价 / 地址·批次 / 概览·详情·查看 / 放弃报价 / 接受·已中标 / 同步 / 询价 / 确认生成·关闭·提交；
 *          表格还原承运商、计价方式、单价、其它附加费用、总报价及箱子与产品明细列。
 */
const STATUS_LABELS: Record<string, string> = {
  DRAFT: '待报价', SUBMITTED: '已提交', ACCEPTED: '已接受', WON: '已中标',
  ABANDONED: '放弃报价', CANCELLED: '已关闭',
};

const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.quoteOrder',
  type: 'document',
  title: '报价单',
  subtitle: 'WIMOOR 报价单功能迁移：承运商、计价方式、单价/附加费用/总报价与接受中标流程（用户显式创建才有数据）',
  addLabel: '新增报价单',
  searchPlaceholder: '请输入询价单号,货件号,SKU,供应商,地址,国家,店铺,备注',
  columns: [
    { key: 'docNo', label: '报价单号', width: 170 },
    { key: 'number', label: '询价单号', width: 150 },
    { key: 'carrier', label: '承运商', width: 150 },
    { key: 'priceType', label: '计价方式', width: 130 },
    { key: 'unitprice', label: '单价(￥)', width: 110, numeric: true },
    { key: 'otherfee', label: '其它/附加费用(￥)', width: 150, numeric: true },
    { key: 'totalfee', label: '总报价(￥)', width: 120, numeric: true },
    {
      key: 'status', label: '状态', width: 120,
      render: (row) => <span className="text-muted">{STATUS_LABELS[String(row.status ?? 'DRAFT')] ?? String(row.status ?? 'DRAFT')}</span>,
    },
    { key: 'boxid', label: '箱子ID', width: 130 },
    { key: 'length', label: '长(cm)', width: 90, numeric: true },
    { key: 'width', label: '宽(cm)', width: 90, numeric: true },
    { key: 'height', label: '高(cm)', width: 90, numeric: true },
    { key: 'weight', label: '重(kg)', width: 90, numeric: true },
    { key: 'sku', label: 'SKU', width: 140 },
    { key: 'name', label: '名称', width: 160 },
    { key: 'quantity', label: '数量', width: 90, numeric: true },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '报价单号', required: true, placeholder: '请输入报价单号' },
    { key: 'number', label: '询价单号', placeholder: '请输入询价单号' },
    { key: 'shipmentid', label: '货件号', placeholder: '请输入货件号' },
    { key: 'carrier', label: '承运商', placeholder: '请选择承运商' },
    { key: 'priceType', label: '计价方式', placeholder: '请选择计价方式' },
    { key: 'unitprice', label: '单价(￥)', kind: 'number', defaultValue: '0' },
    { key: 'otherfee', label: '其它/附加费用(￥)', kind: 'number', defaultValue: '0' },
    { key: 'totalfee', label: '总报价(￥)', kind: 'number', defaultValue: '0' },
    { key: 'boxid', label: '箱子ID', placeholder: '请输入箱子ID' },
    { key: 'length', label: '长(cm)', kind: 'number', defaultValue: '0' },
    { key: 'width', label: '宽(cm)', kind: 'number', defaultValue: '0' },
    { key: 'height', label: '高(cm)', kind: 'number', defaultValue: '0' },
    { key: 'weight', label: '重(kg)', kind: 'number', defaultValue: '0' },
    { key: 'image', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'name', label: '名称', placeholder: '请输入名称' },
    { key: 'sku', label: 'SKU', placeholder: '请输入SKU' },
    { key: 'quantity', label: '数量', kind: 'number', defaultValue: '0' },
    { key: 'remark', label: '备注', placeholder: '输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'DRAFT',
      options: [
        { value: 'DRAFT', label: '待报价' }, { value: 'SUBMITTED', label: '已提交' },
        { value: 'ACCEPTED', label: '已接受' }, { value: 'WON', label: '已中标' },
        { value: 'ABANDONED', label: '放弃报价' }, { value: 'CANCELLED', label: '已关闭' },
      ],
    },
  ],
  extraFilters: [
    { key: 'dateType', label: '日期类型', kind: 'select', defaultValue: 'CREATED',
      options: [{ value: 'CREATED', label: '创建日期' }, { value: 'SHIPPED', label: '发货日期' }],
    },
    { key: 'businessDate', label: '日期', kind: 'date' },
    { key: 'carrier', label: '承运商', placeholder: '选择承运商' },
    { key: 'batch', label: '批次', placeholder: '请输入批次' },
  ],
  transitions: [
    { to: 'SUBMITTED', label: '提交' },
    { to: 'ACCEPTED', label: '接受' },
    { to: 'WON', label: '已中标' },
    { to: 'ABANDONED', label: '放弃报价' },
    { to: 'CANCELLED', label: '关闭' },
  ],
};

export default function WimoorShipmentQuoteOrderPage() {
  return <MasterDataWorkbench config={config} />;
}
