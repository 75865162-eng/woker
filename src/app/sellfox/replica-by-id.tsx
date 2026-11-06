"use client";

import { SalesStatsWorkbench } from "./sales/_components/SalesStatsWorkbench";
import { SalesProfitWorkbench } from "./performance/_components/SalesProfitWorkbench";
import { OnlineProductsWorkbench } from "./listings/_components/OnlineProductsWorkbench";
import { AllOrdersWorkbench } from "./orders/_components/AllOrdersWorkbench";
import { FbaShipmentsWorkbench } from "./shipments/_components/FbaShipmentsWorkbench";
import { ReplenishmentWorkbench } from "./restock/_components/ReplenishmentWorkbench";
import type { ReplicaId } from "@/lib/sellfox/replica-pages";

export function ReplicaById({ id }: { id: ReplicaId }) {
  if (id === "sales") return <SalesStatsWorkbench />;
  if (id === "performance") return <SalesProfitWorkbench />;
  if (id === "listings") return <OnlineProductsWorkbench />;
  if (id === "orders") return <AllOrdersWorkbench />;
  if (id === "shipments") return <FbaShipmentsWorkbench />;
  return <ReplenishmentWorkbench />;
}
