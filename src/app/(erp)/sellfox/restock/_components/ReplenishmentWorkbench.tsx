"use client";

import { ReplicaWorkbench } from "@/components/sellfox/replica/replica-workbench";
import { replicaPage } from "@/lib/sellfox/replica-pages";

export function ReplenishmentWorkbench() {
  const page = replicaPage("restock");
  return page ? <ReplicaWorkbench page={page} /> : null;
}
