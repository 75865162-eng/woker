import { AppShell } from "@/components/app-shell/app-shell";
import { OperationsSyncEntry } from "@/components/operations/sync-center-workbench";

export default function OperationsPage() {
  return (
    <AppShell title="经营中台" subtitle="商品、订单、库存、履约、价格、财务、品牌与售后的八大经营板块">
      <OperationsSyncEntry />
    </AppShell>
  );
}
