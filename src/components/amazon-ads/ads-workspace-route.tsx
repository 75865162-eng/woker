"use client";
import { usePathname, useRouter } from "next/navigation";
import { AdsWorkspace } from "./ads-workspace";
// Mount in the layout so navigation between list/detail/tabs preserves the mock session.
export function AdsWorkspaceRoute() {
  const path = usePathname(), router = useRouter();
  return <AdsWorkspace path={path} navigate={value => router.push(value)} />;
}
