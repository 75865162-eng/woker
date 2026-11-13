import { AppShell } from '@/components/app-shell/app-shell';
import { DictionaryWorkbench } from '@/components/operations/ext/dictionary-workbench';

export default function Page() {
  return <AppShell title="数据字典与自定义字段" subtitle="枚举字典、自定义字段定义的统一登记"><DictionaryWorkbench /></AppShell>;
}
