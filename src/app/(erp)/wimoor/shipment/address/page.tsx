'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 物流海关 → 发货地址」功能迁移。
 * 源组件：amazon/address/index.vue + components/table.vue + components/editdialog.vue
 * 还原交互：添加地址 / 店铺·站点筛选 / 已删地址·未删地址切换 / 默认地址标识 /
 *          名称 / 所在发货地(城市·店铺·站点) / 街道详细地址 / 邮政编码 / 电话 / 操作人 / 编辑·删除；
 *          表单还原店铺、站点、名称、国家、省份、城市、地区、街道、详细地址、邮编、联系人、邮箱、电话、公司名、默认地址。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.address',
  title: '发货地址',
  subtitle: 'WIMOOR 发货地址功能迁移：店铺站点、发货地、详细地址与联系人完整字段（用户显式创建才有数据）',
  addLabel: '添加地址',
  searchPlaceholder: '名称/城市/联系人',
  columns: [
    { key: 'name', label: '名称', width: 160, render: (row) => (
      <span className="flex items-center gap-1"><span>{String(row.name ?? '—')}</span>
        {String(row.isdefault) === 'true' || row.isdefault === true
          ? <span className="text-muted">（默认）</span> : null}
      </span>
    ) },
    { key: 'city', label: '所在发货地', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.city ?? '—')}</span>
        <span className="text-muted">店铺：{String(row.groupname ?? '')}{row.marketname ? ` / 站点：${String(row.marketname)}` : ''}</span></span>
    ) },
    { key: 'addressline1', label: '街道/详细地址', width: 200, render: (row) => (
      <span className="flex flex-col"><span>{String(row.addressline1 ?? '—')}</span>
        {row.addressline2 ? <span className="text-muted">,{String(row.addressline2)}</span> : null}</span>
    ) },
    { key: 'postalcode', label: '邮政编码', width: 110 },
    { key: 'phone', label: '电话', width: 130 },
    { key: 'operator', label: '操作人', width: 110 },
  ],
  fields: [
    { key: 'code', label: '地址编码', required: true, placeholder: '请输入地址编码' },
    { key: 'groupid', label: '店铺', required: true, placeholder: '请输入店铺ID或名称' },
    { key: 'groupname', label: '店铺名称', placeholder: '请输入店铺名称' },
    { key: 'marketplaceid', label: '站点', placeholder: '请输入站点' },
    { key: 'name', label: '名称', required: true, placeholder: '可填店铺名称' },
    { key: 'countrycode', label: '发货地(国家)', defaultValue: 'CN', placeholder: '请输入国家代码' },
    { key: 'stateorprovincecode', label: '省份', placeholder: '请输入省份' },
    { key: 'city', label: '城市', placeholder: '请输入城市' },
    { key: 'districtorcounty', label: '地区', placeholder: '请输入地区' },
    { key: 'addressline1', label: '街道', placeholder: '请输入街道' },
    { key: 'addressline2', label: '详细地址', placeholder: '请输入详细地址' },
    { key: 'postalcode', label: '邮政编码', placeholder: '请输入邮政编码' },
    { key: 'contact', label: '联系人', placeholder: '请输入联系人姓名' },
    { key: 'email', label: '邮箱', placeholder: '请输入联系人邮箱' },
    { key: 'phone', label: '电话', placeholder: '请输入联系人电话' },
    { key: 'companyName', label: '公司名', placeholder: '请输入公司名称' },
    { key: 'isdefault', label: '默认地址', kind: 'select', defaultValue: 'false',
      options: [{ value: 'true', label: '是' }, { value: 'false', label: '否' }],
    },
    { key: 'status', label: '删除状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '未删地址' }, { value: 'INACTIVE', label: '已删地址' }],
    },
  ],
  extraFilters: [
    { key: 'groupname', label: '店铺', placeholder: '请选择店铺' },
    { key: 'marketname', label: '站点', placeholder: '请选择站点' },
    { key: 'status', label: '地址状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '未删地址' }, { value: 'INACTIVE', label: '已删地址' }],
    },
  ],
};

export default function WimoorShipmentAddressPage() {
  return <MasterDataWorkbench config={config} />;
}
