import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell/app-shell";
import { OperationsSyncEntry } from "@/components/operations/sync-center-workbench";
import { AmazonSyncMatrix } from "@/components/operations/amazon-sync-matrix";

export default async function OperationsPage({ searchParams }: { searchParams: Promise<{ view?: string; tab?: string }> }) {
  const { view, tab } = await searchParams;
  if (view === "expense-management") redirect("/operations/expenses");
  const warehouseTabs: Record<string, string> = { warehouses: "warehouses", "warehouse-inbound": "receipts", "warehouse-outbound": "reservations", "warehouse-transfers": "balances" };
  if (view && Object.hasOwn(warehouseTabs, view)) redirect("/logistics/warehouse?tab=" + warehouseTabs[view]);
  // Amazon SP-API / Ads API 独立同步矩阵：与赛狐及其他业务视图完全隔离，直接渲染独立组件。
  if (view === "amazon-sync") return (
    <AppShell title="Amazon 同步矩阵" subtitle="SP-API 与 Ads API 独立同步矩阵 · 只读观察服务端真实状态">
      <AmazonSyncMatrix initialTab={tab === "ads" ? "ads" : "sp"} />
    </AppShell>
  );
  return (
    <AppShell title="经营中台" subtitle="商品、订单、仓储、采购、履约、价格、财务、经营分析与售后">
      <OperationsSyncEntry />
    </AppShell>
  );
}
