'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → listing → 促销报告」功能迁移。
 * 源组件：amazon/report/performance/index.vue
 * 说明：源页面仅 29 行、无筛选项/表格列/按钮，本项目已有功能完整的促销报告页。
 * 等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/promotions），仅承载报告基础字段。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.promotionReport',
  title: '促销报告',
  subtitle: '等价页已存在，本页为 WIMOOR 口径对照入口（等价页 /amazon/promotions）',
  addLabel: '新增促销报告',
  searchPlaceholder: '报告名称',
  columns: [
    { key: 'name', label: '报告名称', width: 220 },
    { key: 'site', label: '站点', width: 120 },
    { key: 'status', label: '状态', width: 100 },
    { key: 'createdAt', label: '生成时间', width: 160 },
    { key: 'remark', label: '备注' },
  ],
  fields: [
    { key: 'name', label: '报告名称', required: true, placeholder: '请输入报告名称' },
    { key: 'site', label: '站点', placeholder: '请输入站点' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }],
    },
    { key: 'createdAt', label: '生成时间', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注...' },
  ],
};

export default function WimoorSalesPromotionReportPage() {
  return <MasterDataWorkbench config={config} />;
}
