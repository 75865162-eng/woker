'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「广告 → 广告报表 → 广告报表下载」功能迁移。
 * 源组件：amazon/advertisement/download/index.vue
 * 还原交互：店铺站点 / 日期 / 汇总方式(Daily·Total) / 广告类型(Sponsored Products·Brands·Display)
 *          / 报表类型(8 种下拉) / 下载报表按钮；文档型工作台把一次下载登记为单据，可编辑并标记完成。
 */
const REPORT_TYPES = [
  { value: 'Campaign', label: 'Campaign' },
  { value: 'Campaign-placement', label: 'Campaign-placement' },
  { value: 'Targeting-Keyword', label: 'Targeting-Keyword' },
  { value: 'Targeting-ProductTarget', label: 'Targeting-ProductTarget' },
  { value: 'Advertised product', label: 'Advertised product' },
  { value: 'Purchased product', label: 'Purchased product' },
  { value: 'Search term-Keyword', label: 'Search term-Keyword' },
  { value: 'Search term-ProductTarget', label: 'Search term-ProductTarget' },
];

const config: MasterDataWorkbenchConfig = {
  kind: 'ads.download',
  type: 'document',
  title: '广告报表下载',
  subtitle: 'WIMOOR 广告报表下载功能迁移：店铺站点、日期、汇总方式、广告类型与 8 种报表类型完整还原（用户显式创建才有记录）',
  addLabel: '下载报表',
  searchPlaceholder: '任务编号',
  columns: [
    { key: 'docNo', label: '任务编号', width: 180 },
    { key: 'reporttype', label: '报表类型', width: 220 },
    {
      key: 'dateType', label: '汇总方式', width: 120,
      render: (row) => <span>{String(row.dateType ?? '') === 'total' ? 'Total' : 'Daily'}</span>,
    },
    { key: 'campaigntype', label: '广告类型', width: 200 },
    { key: 'businessDate', label: '日期', width: 140 },
    {
      key: 'status', label: '状态', width: 120,
      render: (row) => <span className="text-muted">{String(row.status ?? 'DRAFT')}</span>,
    },
  ],
  fields: [
    { key: 'docNo', label: '任务编号', required: true, placeholder: '如 ADREPORT-0001' },
    { key: 'reporttype', label: '报表类型', kind: 'select', defaultValue: 'Campaign', options: REPORT_TYPES },
    { key: 'dateType', label: '汇总方式', kind: 'radio', defaultValue: 'daily',
      options: [{ value: 'daily', label: 'Daily' }, { value: 'total', label: 'Total' }],
    },
    { key: 'campaigntype', label: '广告类型', kind: 'radio', defaultValue: 'Sponsored Products',
      options: [
        { value: 'Sponsored Products', label: 'Sponsored Products' },
        { value: 'Sponsored Brands', label: 'Sponsored Brands' },
        { value: 'Sponsored Display', label: 'Sponsored Display' },
      ],
    },
    { key: 'businessDate', label: '日期', kind: 'date' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'DRAFT',
      options: [{ value: 'DRAFT', label: '草稿' }, { value: 'COMPLETED', label: '已完成' }],
    },
  ],
  extraFilters: [
    { key: 'groupname', label: '店铺站点', placeholder: '请输入店铺/站点' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  transitions: [{ to: 'COMPLETED', label: '标记完成' }],
};

export default function WimoorAdsDownloadPage() {
  return <MasterDataWorkbench config={config} />;
}
