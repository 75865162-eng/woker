import { AppShell } from '@/components/app-shell/app-shell';
import { AssemblyWorkbench } from '@/components/operations/assembly-workbench';

export default function AssemblyPage() {
  return <AppShell title="组装" subtitle="BOM 定义组合商品，组装完成扣组件、产成品并滚成本"><AssemblyWorkbench /></AppShell>;
}
