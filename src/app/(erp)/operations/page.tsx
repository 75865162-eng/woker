import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { OperationsSyncEntry } from "@/components/operations/sync-center-workbench";

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const warehouseTabs: Record<string, string> = { warehouses: "warehouses", "warehouse-inbound": "receipts", "warehouse-outbound": "reservations", "warehouse-transfers": "balances" };
  if (view && Object.hasOwn(warehouseTabs, view)) redirect("/logistics/warehouse?tab=" + warehouseTabs[view]);
  return (
    <AppShell title="经营中台" subtitle="商品、订单、仓储、采购、履约、价格、财务、经营分析与售后">
      <OperationsSyncEntry />
    </AppShell>
  );
}
