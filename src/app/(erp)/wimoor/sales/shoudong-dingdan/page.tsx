'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「销售 → 订单管理 → 手动订单」功能迁移（新增页）。
 * 源组件：amazon/order/fulfillment/index.vue
 * 还原交互：店铺选择 / 日期筛选(开始、结束) / 订单状态(全部订单状态、订单已完成Complete、订单处理中Processing) /
 * 亚马逊订单号搜索 / 列表(亚马逊订单号、其它平台订单号、购买时间、订单评论、订单状态、订单联系信息) /
 * 查看订单详情弹窗 / 关闭。
 * 说明：按单据(document)类型存储，kind=sales.manual-order；docNo=亚马逊订单号、businessDate=购买时间、
 * status=订单状态、remark=订单评论，联系信息(姓名/地址/城市/州区/国家/邮编/电话)存入 payload。
 */
type Row = Record<string, unknown>;
function ext(row: Row): Record<string, unknown> {
  const p = row.payload;
  if (!p) return {};
  if (typeof p === 'string') {
    try { return JSON.parse(p) as Record<string, unknown>; } catch { return {}; }
  }
  return p as Record<string, unknown>;
}
const STATUS: Record<string, string> = { Complete: '已完成', Processing: '处理中' };
const config: MasterDataWorkbenchConfig = {
  kind: 'sales.manual-order',
  type: 'document',
  title: '手动订单',
  subtitle: 'WIMOOR 手动订单迁移（单据类型）：亚马逊订单号/其它平台订单号/购买时间/订单评论/状态/订单联系信息',
  addLabel: '新增手动订单',
  searchPlaceholder: '亚马逊订单号',
  columns: [
    { key: 'docNo', label: '亚马逊订单号', width: 180 },
    { key: 'displayableOrderId', label: '其它平台订单号', width: 180, render: (row) => <span>{String(ext(row).displayableOrderId ?? '') || '—'}</span> },
    { key: 'businessDate', label: '购买时间', width: 160 },
    { key: 'remark', label: '订单评论', width: 180 },
    {
      key: 'status', label: '订单状态', width: 110,
      render: (row) => {
        const s = String(row.status ?? '');
        if (!s) return <span className="text-muted">—</span>;
        return <span className={s === 'Complete' ? 'text-success-ink' : 'text-warning-ink'}>{STATUS[s] ?? s}</span>;
      },
    },
    {
      key: 'destinationAddress', label: '订单联系信息', width: 260,
      render: (row) => {
        const p = ext(row);
        const name = String(p.addressName ?? '');
        if (!name) return <span className="text-muted">—</span>;
        return <span className="flex flex-col">
          <span>姓名:{name}</span>
          <span>地址:{String(p.addressLine1 ?? '')}</span>
          <span>城市:{String(p.city ?? '')} 州/区:{String(p.stateOrRegion ?? '')}</span>
          <span>国家:{String(p.countryCode ?? '')} 邮编:{String(p.postalCode ?? '')} 电话:{String(p.phone ?? '')}</span>
        </span>;
      },
    },
  ],
  fields: [
    { key: 'docNo', label: '亚马逊订单号', required: true, placeholder: '请输入亚马逊订单号' },
    { key: 'displayableOrderId', label: '其它平台订单号', placeholder: '请输入其它平台订单号' },
    { key: 'businessDate', label: '购买时间', kind: 'date' },
    { key: 'remark', label: '订单评论', placeholder: '请输入订单评论' },
    { key: 'status', label: '订单状态', kind: 'select', defaultValue: 'Processing',
      options: [
        { value: 'Processing', label: '订单处理中' }, { value: 'Complete', label: '订单已完成' },
      ],
    },
    { key: 'addressName', label: '姓名', placeholder: '请输入姓名' },
    { key: 'addressLine1', label: '地址', placeholder: '请输入地址' },
    { key: 'city', label: '城市', placeholder: '请输入城市' },
    { key: 'stateOrRegion', label: '州/区', placeholder: '请输入州/区' },
    { key: 'countryCode', label: '国家', placeholder: '请输入国家' },
    { key: 'postalCode', label: '邮政编码', placeholder: '请输入邮政编码' },
    { key: 'phone', label: '电话', placeholder: '请输入电话' },
  ],
  extraFilters: [
    { key: 'orderStatus', label: '订单状态', kind: 'select', defaultValue: '',
      options: [
        { value: '', label: '全部订单状态' }, { value: 'Complete', label: '订单已完成' },
        { value: 'Processing', label: '订单处理中' },
      ],
    },
    { key: 'startDate', label: '开始日期', kind: 'date' },
    { key: 'endDate', label: '结束日期', kind: 'date' },
  ],
};

export default function WimoorSalesManualOrderPage() {
  return <MasterDataWorkbench config={config} />;
}
