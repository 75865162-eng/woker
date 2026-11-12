"use client";

import { ReplicaWorkbench } from "@/components/sellfox/replica/replica-workbench";
import { replicaPage } from "@/lib/sellfox/replica-pages";

export function OnlineProductsWorkbench() {
  const page = replicaPage("listings");
  return page ? <ReplicaWorkbench page={page} /> : null;
}
