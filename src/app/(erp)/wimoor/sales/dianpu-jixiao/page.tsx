'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → 评论&绩效 → 店铺绩效」功能迁移。
 * 源组件：amazon/report/performance/seller/index.vue
 * 还原交互：筛选(目标、订单总数) / 分页。
 * 说明：等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/reviews），承载绩效指标目标/实际口径。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.shopPerformance',
  title: '店铺绩效',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/reviews）：目标/实际值口径对照',
  addLabel: '新增绩效指标',
  searchPlaceholder: '指标名称',
  columns: [
    { key: 'name', label: '指标名称', width: 200 },
    { key: 'target', label: '目标', width: 140, numeric: true },
    { key: 'actual', label: '实际值', width: 140, numeric: true },
    { key: 'status', label: '状态', width: 100 },
    { key: 'remark', label: '备注' },
  ],
  fields: [
    { key: 'name', label: '指标名称', required: true, placeholder: '请输入指标名称' },
    { key: 'target', label: '目标', kind: 'number', defaultValue: '0' },
    { key: 'actual', label: '实际值', kind: 'number', defaultValue: '0' },
    { key: 'status', label: '状态', placeholder: '请输入状态' },
    { key: 'remark', label: '备注', placeholder: '请输入备注...' },
  ],
  extraFilters: [
    { key: 'target', label: '目标', placeholder: '请输入目标' },
    { key: 'orderCount', label: '订单总数', placeholder: '请输入订单总数' },
  ],
};

export default function WimoorSalesSellerPerformancePage() {
  return <MasterDataWorkbench config={config} />;
}
