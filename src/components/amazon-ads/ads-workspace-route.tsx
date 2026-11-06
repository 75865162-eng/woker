"use client";
import { usePathname, useRouter } from "next/navigation";
import { AdsWorkspace } from "./ads-workspace";
// Mount in the layout so local navigation and the explicitly selected Demo retain their state.
export function AdsWorkspaceRoute() {
  const path = usePathname(), router = useRouter();
  return <AdsWorkspace path={path} initialView={/^\/amazon-ads\/(?:campaigns|ad-groups)(?:\/|$)/.test(path) ? "campaigns" : "synced"} navigate={value => router.push(value)} />;
}
