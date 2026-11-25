'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 物流海关 → 物流公司」功能迁移。
 * 源组件：erp/ship/transportation/index.vue + components/list.vue
 * 还原交互：物流维护/物流比价双 Tab / 显示状态(启用·已删除) / 物流公司·公司简称搜索类型 /
 *          添加物流渠道 / 导入·覆盖导入·导出(日期) / 删除 /
 *          物流公司 / 物流接口(已绑定·未绑定) / 报价单(已上传报价·未上传) / 公司简称 / 操作人 / 操作时间 / 详情·编辑。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.transportation',
  title: '物流公司',
  subtitle: 'WIMOOR 物流公司功能迁移：物流维护、接口绑定、报价单上传与显示状态（用户显式创建才有数据）',
  addLabel: '添加物流渠道',
  searchPlaceholder: '请输入物流公司/公司简称',
  columns: [
    { key: 'name', label: '物流公司', width: 180 },
    {
      key: 'api', label: '物流接口', width: 130,
      render: (row) => row.api
        ? <span className="text-success-ink">已绑定</span>
        : <span className="text-muted">未绑定</span>,
    },
    {
      key: 'uploadpath', label: '报价单', width: 150,
      render: (row) => row.uploadpath
        ? <span className="text-warning-ink">已上传报价</span>
        : <span className="text-muted">未上传</span>,
    },
    { key: 'simplename', label: '公司简称', width: 140 },
    { key: 'operator', label: '操作人', width: 120 },
    { key: 'opttime', label: '操作时间', width: 170 },
  ],
  fields: [
    { key: 'code', label: '物流公司编码', required: true, placeholder: '请输入物流公司编码' },
    { key: 'name', label: '物流公司', required: true, placeholder: '请输入物流公司名称' },
    { key: 'simplename', label: '公司简称', placeholder: '请输入公司简称' },
    { key: 'api', label: '物流接口', kind: 'select', defaultValue: '',
      options: [{ value: '', label: '未绑定' }, { value: 'BOUND', label: '已绑定' }],
    },
    { key: 'uploadpath', label: '报价单地址', placeholder: '请输入报价单上传路径' },
    { key: 'operator', label: '操作人', placeholder: '请输入操作人' },
    { key: 'opttime', label: '操作时间', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '显示状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '已删除' }],
    },
  ],
  extraFilters: [
    { key: 'searchType', label: '搜索类型', kind: 'select', defaultValue: '1',
      options: [{ value: '1', label: '物流公司' }, { value: '2', label: '公司简称' }],
    },
    { key: 'status', label: '显示状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '已删除' }],
    },
  ],
};

export default function WimoorShipmentTransportationPage() {
  return <MasterDataWorkbench config={config} />;
}
