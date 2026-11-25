'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「广告 → 分类广告 → 广告操作记录」功能迁移。
 * 源组件：amazon/advertisement/operation_record/index.vue
 * 还原交互：搜索(广告活动/广告组/商品) / 广告组与日期区间筛选 / 操作时间 / 广告活动(店铺-站点双行)
 *          / 广告组 / 日志记录类型(可点开详情) / 操作人员 / 备注(可编辑) / 新增 / 编辑 / 停用 / 分页。
 */
const LOG_TYPES = [
  { value: 'AmzAdvCampaigns', label: '广告活动' },
  { value: 'AmzAdvAdgroups', label: '广告组' },
  { value: 'AmzAdvProductads', label: '商品广告' },
  { value: 'AmzAdvAds', label: '广告' },
  { value: 'AmzAdvKeywords', label: '关键词' },
  { value: 'AmzAdvKeywordsNegativa', label: '否定关键词' },
  { value: 'AmzAdvProductTarge', label: '商品投放' },
  { value: 'AmzAdvProductTargeNegativa', label: '否定商品投放' },
];

const config: MasterDataWorkbenchConfig = {
  kind: 'ads.operation-record',
  title: '广告操作记录',
  subtitle: 'WIMOOR 广告操作记录功能迁移：广告活动/广告组/商品搜索、店铺站点与日期筛选、日志类型、备注完整交互',
  addLabel: '新增操作记录',
  searchPlaceholder: '搜索广告活动/广告组/商品',
  columns: [
    { key: 'opttime', label: '操作时间', width: 160 },
    {
      key: 'campaignName', label: '广告活动(店铺/站点)', width: 240,
      render: (row) => (
        <span className="flex flex-col">
          <span>{String(row.campaignName ?? '—')}</span>
          <span className="text-muted text-xs">{String(row.groupname ?? '')}-{String(row.maketname ?? '')}</span>
        </span>
      ),
    },
    { key: 'adGroupName', label: '广告组', width: 160 },
    {
      key: 'beanclasz', label: '日志记录', width: 200,
      render: (row) => {
        const type = LOG_TYPES.find(t => t.value === String(row.beanclasz));
        const change = Boolean(row.beforeobject);
        return <span className="text-info-ink underline decoration-dotted cursor-pointer">{change ? '更改' : '新增'}{type?.label ?? String(row.opt ?? row.beanclasz ?? '—')}</span>;
      },
    },
    { key: 'username', label: '操作人员', width: 140 },
    { key: 'remark', label: '备注', width: 180, render: (row) => <span>{String(row.remark ?? '—')}</span> },
  ],
  fields: [
    { key: 'code', label: '记录编码', required: true, placeholder: '如 OPT-0001' },
    { key: 'name', label: '操作标题', required: true, placeholder: '请输入操作标题' },
    { key: 'opttime', label: '操作时间', kind: 'date' },
    { key: 'campaignName', label: '广告活动', placeholder: '请输入广告活动名称' },
    { key: 'groupname', label: '店铺', placeholder: '请输入店铺名称' },
    { key: 'maketname', label: '站点', placeholder: '请输入站点' },
    { key: 'adGroupName', label: '广告组', placeholder: '请输入广告组名称' },
    { key: 'beanclasz', label: '日志类型', kind: 'select', defaultValue: 'AmzAdvCampaigns', options: LOG_TYPES },
    { key: 'beforeobject', label: '变更类型', kind: 'select', defaultValue: 'false',
      options: [{ value: 'false', label: '新增' }, { value: 'true', label: '更改' }],
    },
    { key: 'username', label: '操作人员', placeholder: '请输入操作人员' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'groupid', label: '广告组ID', placeholder: '请输入广告组ID' },
    { key: 'fromDate', label: '开始日期', kind: 'date' },
    { key: 'endDate', label: '结束日期', kind: 'date' },
  ],
};

export default function WimoorAdsOperationRecordPage() {
  return <MasterDataWorkbench config={config} />;
}
