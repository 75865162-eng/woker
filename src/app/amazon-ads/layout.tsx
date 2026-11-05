import { redirect } from "next/navigation";
import { AdsWorkspaceRoute } from "@/components/amazon-ads/ads-workspace-route";
import { AppShell } from "@/components/app-shell/app-shell";
import { getCurrentUserFromSignedCookie } from "@/lib/auth/session";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import "@/components/amazon-ads/amazon-ads.css";
// The fixture workspace inherits PPC view access without changing the global permission schema.
export default async function AmazonAdsLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserFromSignedCookie();
  if (!user) redirect("/login");
  const snapshot = user.organizationId ? await getOrganizationRolePermissionsSnapshot(user.organizationId) : null;
  if (!roleCanPerformAction(user.role, "workspace", "view", snapshot?.permissions)) redirect("/forbidden?from=%2Famazon-ads");
  return <AppShell title="Amazon Ads" subtitle="广告管理中心 · 本地交互原型" initialUser={user} initialRolePermissions={snapshot?.permissions}><AdsWorkspaceRoute />{children}</AppShell>;
}
