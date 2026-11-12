"use client";

import { ReplicaWorkbench } from "@/components/sellfox/replica/replica-workbench";
import { replicaPage } from "@/lib/sellfox/replica-pages";

export function AllOrdersWorkbench() {
  const page = replicaPage("orders");
  return page ? <ReplicaWorkbench page={page} /> : null;
}
