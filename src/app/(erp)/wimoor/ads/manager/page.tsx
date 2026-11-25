'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「广告 → 分类广告 → 广告管理」功能迁移。
 * 源组件：amazon/advertisement/manager/index.vue（广告树 + portfolios/广告活动/广告组/商品广告/关键词/投放多标签列表）
 * 本项目已有等价页：/amazon-ads（Amazon 广告持久工作台）、/sellfox/ads（CPC 报表工作台）。
 * 本页用通用工作台承载广告活动清单：标签维度作为更多条件，还原广告活动/广告组/店铺站点/广告类型/状态/预算等交互。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'ads.manager',
  title: '广告管理',
  subtitle: 'WIMOOR 广告管理功能迁移：广告活动清单，portfolios/广告活动/广告组/商品广告/关键词/投放维度与店铺站点筛选',
  addLabel: '新建广告活动',
  searchPlaceholder: '搜索广告活动/广告组/商品',
  columns: [
    { key: 'name', label: '广告活动', width: 240 },
    {
      key: 'campaignType', label: '广告类型', width: 130,
      render: (row) => {
        const types: Record<string, string> = { SP: '商品推广', SB: '品牌推广', SD: '展示推广' };
        return <span>{types[String(row.campaignType)] ?? String(row.campaignType ?? '—')}</span>;
      },
    },
    { key: 'portfolio', label: '广告组合', width: 180 },
    { key: 'groupname', label: '店铺', width: 150 },
    { key: 'maketname', label: '站点', width: 120 },
    { key: 'budget', label: '日限额', width: 120, numeric: true },
    {
      key: 'status', label: '状态', width: 110,
      render: (row) => <span className={String(row.status) === 'ENABLED' ? 'text-success-ink' : 'text-muted'}>
        {String(row.status ?? '') === 'ENABLED' ? '启用' : String(row.status ?? '') === 'PAUSED' ? '暂停' : '归档'}
      </span>,
    },
    { key: 'startDate', label: '开始日期', width: 140 },
    { key: 'endDate', label: '结束日期', width: 140 },
  ],
  fields: [
    { key: 'code', label: '活动ID', required: true, placeholder: '如 CAMPAIGN-0001' },
    { key: 'name', label: '广告活动名称', required: true, placeholder: '请输入广告活动名称' },
    { key: 'campaignType', label: '广告类型', kind: 'select', defaultValue: 'SP',
      options: [
        { value: 'SP', label: '商品推广' }, { value: 'SB', label: '品牌推广' }, { value: 'SD', label: '展示推广' },
      ],
    },
    { key: 'portfolio', label: '广告组合', placeholder: '请输入广告组合' },
    { key: 'groupname', label: '店铺', placeholder: '请输入店铺名称' },
    { key: 'maketname', label: '站点', placeholder: '请输入站点' },
    { key: 'budget', label: '日限额', kind: 'number', placeholder: '请输入日限额' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ENABLED',
      options: [
        { value: 'ENABLED', label: '启用' }, { value: 'PAUSED', label: '暂停' }, { value: 'ARCHIVED', label: '归档' },
      ],
    },
    { key: 'startDate', label: '开始日期', kind: 'date' },
    { key: 'endDate', label: '结束日期', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
  ],
  extraFilters: [
    { key: 'tab', label: '标签维度', kind: 'select', defaultValue: 'adcams',
      options: [
        { value: 'adcams', label: '广告活动' }, { value: 'adgroups', label: '广告组' },
        { value: 'ProductAds', label: '商品广告' }, { value: 'adkey', label: '关键词' },
        { value: 'adsearch', label: '搜索词' }, { value: 'adnkey', label: '否定关键词' },
        { value: 'adtarget', label: '商品投放' },
      ],
    },
    { key: 'groupid', label: '广告组ID', placeholder: '请输入广告组ID' },
  ],
};

export default function WimoorAdsManagerPage() {
  return <MasterDataWorkbench config={config} />;
}
