import { AppShell } from '@/components/app-shell/app-shell';
import { OpsExtensionsWorkbench } from '@/components/operations/ops-extensions-workbench';

export default function OpsExtensionsPage() {
  return <AppShell title="运营资料与滞销" subtitle="承运商、三方仓主数据与只读库存生成的滞销判定快照"><OpsExtensionsWorkbench /></AppShell>;
}
