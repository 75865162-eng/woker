"use client";

import { ReplicaWorkbench } from "@/components/sellfox/replica/replica-workbench";
import { replicaPage } from "@/lib/sellfox/replica-pages";

export function FbaShipmentsWorkbench() {
  const page = replicaPage("shipments");
  return page ? <ReplicaWorkbench page={page} /> : null;
}
