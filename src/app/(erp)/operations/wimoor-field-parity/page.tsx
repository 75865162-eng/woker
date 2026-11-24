import { AppShell } from '@/components/app-shell/app-shell';
import { WimoorFieldParityWorkbench } from '@/components/operations/wimoor-field-parity-workbench';

export default function WimoorFieldParityPage() {
  return <AppShell title="Wimoor 字段对标" subtitle="Wimoor ↔ 本项目 ↔ SP-API 字段级差距矩阵（P0–P2 全量，派生口径源码实证，不臆造数据）"><WimoorFieldParityWorkbench /></AppShell>;
}
