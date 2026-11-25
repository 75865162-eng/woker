'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「仓库 → 出入库 → 库存盘点」功能迁移。
 * 源组件：erp/warehouse/stocktake/index.vue + components/table.vue
 * 还原交互：全部订单/进行中/已完成 状态页签 / 单据编码搜索 / 仓库与日期筛选 / 添加盘点单 / 详情 /
 *          盘点完成-作废 状态流转 / 仓库与库位盘点数、盘盈盘亏金额。
 * 说明：盘点完成状态映射 COMPLETED，进行中映射 DRAFT；框架不自动过账。
 */
type Row = Record<string, unknown>;
function ext(row: Row): Record<string, unknown> {
  const p = row.payload;
  if (!p) return {};
  if (typeof p === 'string') { try { return JSON.parse(p) as Record<string, unknown>; } catch { return {}; } }
  return p as Record<string, unknown>;
}
const config: MasterDataWorkbenchConfig = {
  kind: 'warehouse.stocktake',
  type: 'document',
  title: '库存盘点',
  subtitle: 'WIMOOR 库存盘点迁移：盘点仓库/库位、SKU与盘点数、盘存/盘盈/盘亏金额、盘点状态流转',
  addLabel: '添加盘点单',
  searchPlaceholder: '单据编码',
  transitions: [
    { to: 'COMPLETED', label: '盘点完成' },
    { to: 'CANCELLED', label: '作废' },
  ],
  extraFilters: [
    { key: 'warehouseid', label: '仓库', placeholder: '请输入仓库ID' },
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'toDate', label: '结束日期', kind: 'date' },
  ],
  columns: [
    { key: 'docNo', label: '盘点单编码', width: 150 },
    {
      key: 'warehouselist', label: '名称（仓库/库位）', width: 200,
      render: (row) => <span className="text-muted">{String(ext(row).warehouselist ?? ext(row).shelflist ?? '—')}</span>,
    },
    { key: 'skunum', label: 'SKU数量', width: 110, numeric: true, render: (row) => <span>{String(ext(row).skunum ?? '—')}</span> },
    { key: 'amount', label: '盘点数', width: 110, numeric: true },
    { key: 'amountprice', label: '盘存金额(¥)', width: 130, numeric: true, render: (row) => <span>{String(ext(row).amountprice ?? '—')}</span> },
    { key: 'overamountprice', label: '盘盈金额(¥)', width: 130, numeric: true, render: (row) => <span>{String(ext(row).overamountprice ?? '—')}</span> },
    { key: 'lossamountprice', label: '盘亏金额(¥)', width: 130, numeric: true, render: (row) => <span>{String(ext(row).lossamountprice ?? '—')}</span> },
    {
      key: 'isworking', label: '盘点状态', width: 110,
      render: (row) => <span>{row.status === 'COMPLETED' ? '盘点完成' : row.status === 'CANCELLED' ? '已作废' : '正在盘点'}</span>,
    },
    { key: 'businessDate', label: '创建时间', width: 160 },
    { key: 'remark', label: '备注', width: 180 },
  ],
  fields: [
    { key: 'docNo', label: '盘点单编码', required: true, placeholder: '请输入盘点单编码' },
    { key: 'warehouselist', label: '盘点仓库', placeholder: '请输入盘点仓库（多个用逗号分隔）' },
    { key: 'shelflist', label: '盘点库位', placeholder: '请输入盘点库位（多个用逗号分隔）' },
    { key: 'skunum', label: 'SKU数量', kind: 'number', placeholder: '请输入SKU数量' },
    { key: 'amount', label: '盘点数', kind: 'number', placeholder: '请输入盘点数' },
    { key: 'amountprice', label: '盘存金额', kind: 'number', placeholder: '请输入盘存金额' },
    { key: 'overamountprice', label: '盘盈金额', kind: 'number', placeholder: '请输入盘盈金额' },
    { key: 'lossamountprice', label: '盘亏金额', kind: 'number', placeholder: '请输入盘亏金额' },
    { key: 'partnerCode', label: '创建人', placeholder: '请输入创建人' },
    { key: 'businessDate', label: '创建时间', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '盘点状态', kind: 'select', defaultValue: 'DRAFT',
      options: [
        { value: 'DRAFT', label: '进行中' }, { value: 'COMPLETED', label: '已完成' },
        { value: 'CANCELLED', label: '已作废' },
      ],
    },
  ],
};

export default function WimoorWarehouseStocktakePage() {
  return <MasterDataWorkbench config={config} />;
}
