import { AppShell } from '@/components/app-shell/app-shell';
import { RepricingWorkbench } from '@/components/operations/ext/repricing-workbench';

export default function Page() {
  return <AppShell title="跟卖与调价" subtitle="跟卖监控、调价规则与人工采纳队列"><RepricingWorkbench /></AppShell>;
}
