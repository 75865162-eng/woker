'use client';
import { MasterDataWorkbench, type MasterDataWorkbenchConfig } from '@/components/wimoor-migration/master-data-workbench';

/**
 * WIMOOR「仓库 → 基础信息 → 仓库地址」功能迁移。
 * 源组件：erp/warehouse/address/index.vue
 * 还原交互：名称/状态(正常-删除)筛选 / 重置 / 添加地址 / 编辑 / 删除 / 绑定仓库 / 解绑仓库 / 还原 /
 *          地址编码必填三位校验 / 到期时间 / 分页。
 * 说明：绑定/解绑通过 payload 中的 boundWarehouseList 与状态 ACTIVE/INACTIVE 表达，不臆造仓库选项。
 */
const config: MasterDataWorkbenchConfig = {
  kind: 'warehouse.address',
  title: '仓库地址',
  subtitle: 'WIMOOR 仓库地址迁移：地址名称/编码/详情/绑定仓库/邮编/业主/到期时间/绑定与还原完整交互',
  addLabel: '添加地址',
  searchPlaceholder: '名称',
  extraFilters: [
    { key: 'status', label: '状态', kind: 'select',
      options: [{ value: 'ACTIVE', label: '正常' }, { value: 'INACTIVE', label: '删除' }],
      defaultValue: 'ACTIVE',
    },
  ],
  columns: [
    { key: 'name', label: '地址名称', width: 200 },
    { key: 'code', label: '地址编码', width: 110 },
    { key: 'detail', label: '地址详情', width: 220 },
    {
      key: 'boundWarehouseList', label: '对应仓库', width: 200,
      render: (row) => {
        const list = row.boundWarehouseList;
        if (!Array.isArray(list) || list.length === 0) return <span className="text-muted">—</span>;
        return <span className="flex flex-wrap gap-1">{list.map((w: { name?: string; id?: string }, i: number) => (
          <span key={w.id ?? i} className="rounded border border-border px-1 text-xs">{String(w.name ?? '')}</span>
        ))}</span>;
      },
    },
    { key: 'postcode', label: '邮编', width: 90 },
    { key: 'phone', label: '业主电话', width: 120 },
    { key: 'landlord', label: '业主姓名', width: 120 },
    { key: 'remark', label: '备注', width: 160 },
    { key: 'lostEffectDate', label: '到期时间', width: 140 },
    {
      key: 'status', label: '状态', width: 90,
      render: (row) => <span className={row.status === 'ACTIVE' ? 'text-success-ink' : 'text-muted'}>{row.status === 'INACTIVE' ? '删除' : '正常'}</span>,
    },
  ],
  fields: [
    { key: 'name', label: '地址名称', required: true, placeholder: '请输入地址名称，建议地址名称等于仓库分组名称' },
    { key: 'code', label: '地址编码', required: true, max: 3, placeholder: '001(注意:请勿使用中文)' },
    { key: 'detail', label: '地址详情', placeholder: '请输入地址详情如:xx省xx市龙xx区xx街道xxx社区xxx栋xxx' },
    { key: 'postcode', label: '邮编', placeholder: '邮编' },
    { key: 'phone', label: '业主电话', placeholder: '地址所拥有者的电话' },
    { key: 'landlord', label: '业主姓名', placeholder: '王小二' },
    { key: 'remark', label: '备注', placeholder: '备注' },
    { key: 'lostEffectDate', label: '到期时间', kind: 'date', placeholder: '请选择使用地址的到期时间' },
    { key: 'boundWarehouseList', label: '绑定仓库', placeholder: '请输入要绑定的仓库（多个用逗号分隔）' },
    { key: 'status', label: '状态', kind: 'select', defaultValue: 'ACTIVE',
      options: [{ value: 'ACTIVE', label: '正常' }, { value: 'INACTIVE', label: '删除' }],
    },
  ],
};

export default function WimoorWarehouseAddressPage() {
  return <MasterDataWorkbench config={config} />;
}
