'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「发货 → 物流报价 → 渠道管理」功能迁移。
 * 源组件：erp/shipv2/quote/channel.vue
 * 还原交互：名称搜索 / 渠道类型(全部)下拉 / 新增 / 上传 / 更新 / 删除 / 取消·确认 /
 *          名称 / 渠道类型名称 / 物流公司 / 操作时间 列表。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'shipment.channel',
  title: '渠道管理',
  subtitle: 'WIMOOR 渠道管理功能迁移：渠道名称、渠道类型、物流公司与上传时间（用户显式创建才有数据）',
  addLabel: '新增渠道',
  searchPlaceholder: '请输入名称',
  columns: [
    { key: 'name', label: '名称', width: 180 },
    { key: 'channeltype', label: '渠道类型名称', width: 180 },
    { key: 'company', label: '物流公司', width: 180 },
    { key: 'opttime', label: '操作时间', width: 170 },
  ],
  fields: [
    { key: 'code', label: '渠道编码', required: true, placeholder: '请输入渠道编码' },
    { key: 'name', label: '名称', required: true, placeholder: '请输入渠道名称' },
    { key: 'channeltype', label: '渠道类型', placeholder: '请选择渠道类型' },
    { key: 'company', label: '物流公司', placeholder: '请选择物流公司' },
    { key: 'opttime', label: '操作时间', kind: 'date' },
    { key: 'remark', label: '备注', placeholder: '请输入备注' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '启用' }, { value: 'INACTIVE', label: '停用' }],
    },
  ],
  extraFilters: [
    { key: 'channeltype', label: '渠道类型', kind: 'select', defaultValue: '',
      options: [{ value: '', label: '全部' }],
    },
    { key: 'company', label: '物流公司', placeholder: '请选择物流公司' },
  ],
};

export default function WimoorShipmentChannelPage() {
  return <MasterDataWorkbench config={config} />;
}
