"use client";

import { ReplicaWorkbench } from "@/components/sellfox/replica/replica-workbench";
import { replicaPage } from "@/lib/sellfox/replica-pages";

export function SalesStatsWorkbench() {
  const page = replicaPage("sales");
  return page ? <ReplicaWorkbench page={page} /> : null;
}
