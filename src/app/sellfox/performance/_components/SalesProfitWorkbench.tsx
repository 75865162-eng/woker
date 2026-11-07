"use client";

import { ReplicaWorkbench } from "@/components/sellfox/replica/replica-workbench";
import { replicaPage } from "@/lib/sellfox/replica-pages";

export function SalesProfitWorkbench() {
  const page = replicaPage("performance");
  return page ? <ReplicaWorkbench page={page} /> : null;
}
