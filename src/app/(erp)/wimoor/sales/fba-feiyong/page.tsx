'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → FBA报表 → FBA费用」功能迁移。
 * 源组件：amazon/report/fba_fee/index.vue
 * 还原列口径：图片(img)、商品信息(product)、参数类型(QuantityOrdered)、尺寸长宽高cm(total_price)、
 * 重量kg(sweight)、价格(price)、尺寸分段、FBA收费每月预计超收费用(overcharge)、更新时间。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/fees）。
 * 注：源表存在同名字段 price，本页拆分为 price/sizeTier/updateTime 以保证列键唯一，标签保持源口径。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.fbaFees',
  title: 'FBA费用',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/fees）：尺寸/重量/价格/尺寸分段/超收费用/更新时间',
  addLabel: '新增FBA费用记录',
  searchPlaceholder: '商品信息',
  columns: [
    { key: 'img', label: '图片', width: 70, render: (row) => row.img
      ? <img src={String(row.img)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'product', label: '商品信息', width: 220 },
    { key: 'paramType', label: '参数类型', width: 120 },
    { key: 'dimension', label: '尺寸(长*宽*高cm)', width: 160 },
    { key: 'sweight', label: '重量（kg）', width: 110, numeric: true },
    { key: 'price', label: '价格', width: 100, numeric: true },
    { key: 'sizeTier', label: '尺寸分段', width: 110 },
    { key: 'overcharge', label: 'FBA收费(每月预计超收费用)', width: 200, numeric: true },
    { key: 'updateTime', label: '更新时间', width: 150 },
  ],
  fields: [
    { key: 'product', label: '商品信息', required: true, placeholder: '请输入商品信息' },
    { key: 'img', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'paramType', label: '参数类型', placeholder: '请输入参数类型' },
    { key: 'dimension', label: '尺寸(长*宽*高cm)', placeholder: '请输入尺寸' },
    { key: 'sweight', label: '重量（kg）', kind: 'number', defaultValue: '0' },
    { key: 'price', label: '价格', kind: 'number', defaultValue: '0' },
    { key: 'sizeTier', label: '尺寸分段', placeholder: '请输入尺寸分段' },
    { key: 'overcharge', label: 'FBA收费(每月预计超收费用)', kind: 'number', defaultValue: '0' },
    { key: 'updateTime', label: '更新时间', kind: 'date' },
  ],
};

export default function WimoorSalesFbaFeePage() {
  return <MasterDataWorkbench config={config} />;
}
