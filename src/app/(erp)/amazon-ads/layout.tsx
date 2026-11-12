import { redirect } from "next/navigation";
import { AdsWorkspaceRoute } from "@/components/amazon-ads/ads-workspace-route";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCurrentUserFromSignedCookie } from "@/lib/auth/session";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import "@/components/amazon-ads/amazon-ads.css";
// Local Ads reads inherit PPC view access; API handlers independently enforce current scope.
export default async function AmazonAdsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserFromSignedCookie();
  if (!user) redirect("/login");
  const snapshot = user.organizationId ? await getOrganizationRolePermissionsSnapshot(user.organizationId) : null;
  if (!roleCanPerformAction(user.role, "workspace", "view", snapshot?.permissions)) redirect("/forbidden?from=%2Famazon-ads");
  return <AppShell title="Amazon Ads" subtitle="广告管理中心 · 本地数据工作台"><AdsWorkspaceRoute />{children}</AppShell>;
}
