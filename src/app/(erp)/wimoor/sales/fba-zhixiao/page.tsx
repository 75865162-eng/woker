'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → FBA报表 → FBA滞销」功能迁移。
 * 源组件：amazon/inventory/planning/index.vue
 * 还原交互：搜索(SKU/ASIN/订单号) / 重置 / 导出 / 分页；
 * 20 项更多条件：存储体积、商品体积、体积计量单位、仓储类型、健康库存级别、建议操作、售价、建议售价、
 * 建议售价天数、建议移除数量、预估可节约成本、发货中、已发货、接收中、待入库、售罄率、销售排名、
 * 产品分类、11个月滞销数量、11个月费用。
 * 列：库存健康/供货天数/周转(30天、90天)/滞销费用/下月仓储费/季度与月度库龄/销售额/最近发货/冗余库存/库龄附加费。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/inventory-health）。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.fbaSlowMoving',
  title: 'FBA滞销',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/inventory-health）：库存健康/库龄/滞销费用/仓储费口径对照',
  addLabel: '新增库存记录',
  searchPlaceholder: '请输入 SKU',
  columns: [
    { key: 'image', label: '图片', width: 70, render: (row) => row.image
      ? <img src={String(row.image)} alt="商品图片" className="h-10 w-10 object-cover" />
      : <span className="text-muted">—</span> },
    { key: 'name', label: '商品信息', width: 200 },
    { key: 'site', label: '站点信息', width: 130 },
    { key: 'purchasecost', label: '采购成本', width: 110, numeric: true },
    { key: 'available', label: '可用库存', width: 100, numeric: true },
    { key: 'sellThrough', label: '持续供货', width: 100, numeric: true },
    { key: 'fbaInventoryLevelHealthStatus', label: '库存健康状况', width: 130 },
    { key: 'historicalDaysOfSupply', label: '历史供货天数', width: 120, numeric: true },
    { key: 'fbaMinimumInventoryLevel', label: '低库存水平量', width: 120, numeric: true },
    { key: 'weeksOfCoverT30', label: '30天', width: 90, numeric: true },
    { key: 'weeksOfCoverT90', label: '90天', width: 90, numeric: true },
    { key: 'estimatedLtsfNextCharge', label: '滞销费用', width: 110, numeric: true },
    { key: 'estimatedStorageCostNextMonth', label: '下月仓储费', width: 120, numeric: true },
    { key: 'invAge0To90Days', label: '季度-0-90', width: 100, numeric: true },
    { key: 'invAge91To180Days', label: '季度-≤180', width: 100, numeric: true },
    { key: 'invAge181To270Days', label: '季度-≤270', width: 100, numeric: true },
    { key: 'invAge271To365Days', label: '季度-≤365', width: 100, numeric: true },
    { key: 'invAge365PlusDays', label: '季度-365+', width: 100, numeric: true },
    { key: 'invAge0To30Days', label: '月度-0-30', width: 100, numeric: true },
    { key: 'invAge31To60Days', label: '月度-≤60', width: 100, numeric: true },
    { key: 'invAge61To90Days', label: '月度-≤90', width: 100, numeric: true },
    { key: 'invAge181To330Days', label: '月度-181-330', width: 110, numeric: true },
    { key: 'invAge331To365Days', label: '月度-≤365', width: 100, numeric: true },
    { key: 'salesAmount', label: '销售额(站点币种)', width: 130, numeric: true },
    { key: 'salesShippedLast7Days', label: '销售额-7天', width: 100, numeric: true },
    { key: 'salesShippedLast30Days', label: '销售额-30天', width: 100, numeric: true },
    { key: 'salesShippedLast60Days', label: '销售额-60天', width: 100, numeric: true },
    { key: 'salesShippedLast90Days', label: '销售额-90天', width: 100, numeric: true },
    { key: 'unitsShippedT7', label: '最近发货-7', width: 100, numeric: true },
    { key: 'unitsShippedT30', label: '最近发货-30', width: 100, numeric: true },
    { key: 'unitsShippedT60', label: '最近发货-60', width: 100, numeric: true },
    { key: 'unitsShippedT90', label: '最近发货-90', width: 100, numeric: true },
    { key: 'estimatedExcessQuantity', label: '冗余库存', width: 100, numeric: true },
    { key: 'quantityToBeChargedAis181T210Days', label: '库龄附加费-180-210', width: 130, numeric: true },
    { key: 'quantityToBeChargedAis211T240Days', label: '库龄附加费-≤240', width: 130, numeric: true },
  ],
  fields: [
    { key: 'sku', label: 'SKU', required: true, placeholder: '请输入 SKU' },
    { key: 'name', label: '商品信息', placeholder: '请输入商品信息' },
    { key: 'image', label: '图片地址', placeholder: '请输入图片地址' },
    { key: 'site', label: '站点信息', placeholder: '请输入站点信息' },
    { key: 'purchasecost', label: '采购成本', kind: 'number', defaultValue: '0' },
    { key: 'available', label: '可用库存', kind: 'number', defaultValue: '0' },
    { key: 'sellThrough', label: '持续供货', kind: 'number', defaultValue: '0' },
    { key: 'fbaInventoryLevelHealthStatus', label: '库存健康状况', placeholder: '请输入库存健康状况' },
    { key: 'historicalDaysOfSupply', label: '历史供货天数', kind: 'number', defaultValue: '0' },
    { key: 'estimatedLtsfNextCharge', label: '滞销费用', kind: 'number', defaultValue: '0' },
    { key: 'estimatedStorageCostNextMonth', label: '下月仓储费', kind: 'number', defaultValue: '0' },
  ],
  extraFilters: [
    { key: 'searchType', label: '搜索类型', kind: 'select', defaultValue: 'SKU',
      options: [{ value: 'SKU', label: 'SKU' }, { value: 'ASIN', label: 'ASIN' }, { value: '订单号', label: '订单号' }],
    },
    { key: 'storageVolume', label: '存储体积', placeholder: '请选择筛选条件' },
    { key: 'productVolume', label: '商品体积', placeholder: '请选择筛选条件' },
    { key: 'volumeUnit', label: '体积计量单位', placeholder: '请选择筛选条件' },
    { key: 'storageType', label: '仓储类型', placeholder: '请选择筛选条件' },
    { key: 'healthLevel', label: '健康库存级别', placeholder: '请选择筛选条件' },
    { key: 'suggestion', label: '建议操作', placeholder: '请选择筛选条件' },
    { key: 'price', label: '售价', placeholder: '请选择筛选条件' },
    { key: 'suggestedPrice', label: '建议售价', placeholder: '请选择筛选条件' },
    { key: 'suggestedPriceDays', label: '建议售价天数', placeholder: '请选择筛选条件' },
    { key: 'suggestedRemoveQty', label: '建议移除数量', placeholder: '请选择筛选条件' },
    { key: 'estimatedSaving', label: '预估可节约成本', placeholder: '请选择筛选条件' },
    { key: 'shipping', label: '发货中', placeholder: '请选择筛选条件' },
    { key: 'shipped', label: '已发货', placeholder: '请选择筛选条件' },
    { key: 'receiving', label: '接收中', placeholder: '请选择筛选条件' },
    { key: 'pendingInbound', label: '待入库', placeholder: '请选择筛选条件' },
    { key: 'sellThroughRate', label: '售罄率', placeholder: '请选择筛选条件' },
    { key: 'salesRank', label: '销售排名', placeholder: '请选择筛选条件' },
    { key: 'category', label: '产品分类', placeholder: '请选择筛选条件' },
    { key: 'slowMoving11mQty', label: '11个月滞销数量', placeholder: '请选择筛选条件' },
    { key: 'slowMoving11mFee', label: '11个月费用', placeholder: '请选择筛选条件' },
  ],
};

export default function WimoorSalesFbaSlowMovingPage() {
  return <MasterDataWorkbench config={config} />;
}
