import { prisma } from "@/lib/db/prisma";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { getAuthorizationContext } from "@/lib/auth/authorization-context";
import type { CurrentUser } from "@/lib/auth/session";

export type PointsAccess = {
  canViewSelf: boolean;
  canViewOrg: boolean;
  canAdjust: boolean;
  canApprove: boolean;
  canConfigure: boolean;
};

export type PointsAuthContext = {
  user: CurrentUser;
  access: PointsAccess;
};

/** 统一解析积分相关权限。无权限的元素在 UI 层直接不渲染，不做 disabled。 */
export async function getPointsAccessContext(request?: Request): Promise<PointsAuthContext | null> {
  const authorization = await getAuthorizationContext(request);
  if (!authorization?.user) return null;

  const { user, permissions } = authorization;

  const [canViewOrg, canAdjust, canApproveByRole, canConfigure, override] = await Promise.all([
    Promise.resolve(roleCanPerformAction(user.role, "accounts", "view", permissions)),
    Promise.resolve(roleCanPerformAction(user.role, "accounts", "edit", permissions)),
    Promise.resolve(roleCanPerformAction(user.role, "accounts", "approve", permissions)),
    Promise.resolve(roleCanPerformAction(user.role, "settings", "edit", permissions)),
    prisma.pointsMemberOverride.findUnique({
      where: { organizationId_userId: { organizationId: user.organizationId, userId: user.id } },
      select: { canApprove: true, canRequest: true },
    }),
  ]);

  const isOwner = user.role === "owner";

  return {
    user,
    access: {
      canViewSelf: true,
      canViewOrg: isOwner || canViewOrg || canAdjust,
      canAdjust,
      canApprove: isOwner || canApproveByRole || Boolean(override?.canApprove),
      canConfigure,
    },
  };
}

export async function canRequestPoints(user: CurrentUser): Promise<boolean> {
  const override = await prisma.pointsMemberOverride.findUnique({
    where: { organizationId_userId: { organizationId: user.organizationId, userId: user.id } },
    select: { canRequest: true },
  });

  return override?.canRequest ?? true;
}
