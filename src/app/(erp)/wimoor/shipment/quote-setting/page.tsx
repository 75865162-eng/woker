'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 物流报价 → 关联设置」功能迁移。
 * 源组件：erp/shipv2/quote/setting.vue
 * 还原交互：新增 / 编辑 / 删除 / 绑定·解绑 / 修改·保存 /
 *          令牌(填写询价商Token) / 别名 / 供应商名称 / 名称 / 地址 / 手机号 / 联系人 /
 *          链接 / 状态 / 创建时间 列表与表单。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.quoteSetting',
  title: '关联设置',
  subtitle: 'WIMOOR 询价商关联设置功能迁移：令牌、别名、供应商、联系人、链接与绑定状态（用户显式创建才有数据）',
  addLabel: '新增关联',
  searchPlaceholder: '名称/联系人/别名',
  columns: [
    { key: 'name', label: '名称', width: 180 },
    { key: 'contact', label: '联系人', width: 130 },
    { key: 'phone', label: '手机号', width: 140 },
    { key: 'link', label: '链接', width: 200 },
    {
      key: 'status', label: '状态', width: 110,
      render: (row) => <span className={row.status === 'ACTIVE' ? 'text-success-ink' : 'text-muted'}>{row.status === 'ACTIVE' ? '已绑定' : '已解绑'}</span>,
    },
    { key: 'createtime', label: '创建时间', width: 170 },
  ],
  fields: [
    { key: 'code', label: '编码', required: true, placeholder: '请输入编码' },
    { key: 'token', label: '令牌', required: true, placeholder: '填写询价商Token' },
    { key: 'alias', label: '别名', placeholder: '填写别名' },
    { key: 'name', label: '供应商名称', required: true, placeholder: '填写供应商名称' },
    { key: 'address', label: '地址', placeholder: '填写地址信息' },
    { key: 'phone', label: '手机号', placeholder: '填写手机号' },
    { key: 'contact', label: '联系人', placeholder: '填写联系人' },
    { key: 'link', label: '链接', placeholder: '请输入链接' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '已绑定' }, { value: 'INACTIVE', label: '已解绑' }],
    },
    { key: 'createtime', label: '创建时间', kind: 'date' },
  ],
  extraFilters: [
    { key: 'name', label: '供应商名称', placeholder: '请输入供应商名称' },
    { key: 'contact', label: '联系人', placeholder: '请输入联系人' },
  ],
};

export default function WimoorShipmentQuoteSettingPage() {
  return <MasterDataWorkbench config={config} />;
}
