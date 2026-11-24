import { AppShell } from '@/components/app-shell/app-shell';
import { SystemAdminWorkbench } from '@/components/operations/ext/system-admin-workbench';

export default function Page() {
  return <AppShell title="系统管理" subtitle="部门主数据、公告发布、个人记事本与在线用户监控"><SystemAdminWorkbench /></AppShell>;
}
