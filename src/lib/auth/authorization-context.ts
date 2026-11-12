import { cache } from "react";
import { getCurrentUser, getCurrentUserFromRequest } from "./session";
import { getOrganizationRolePermissionsSnapshot } from "@/lib/accounts/role-permissions-server";

async function loadAuthorization(userPromise: ReturnType<typeof getCurrentUser>) {
  const user = await userPromise;
  if (!user) return null;
  const snapshot = await getOrganizationRolePermissionsSnapshot(user.organizationId);
  return { user, permissions: snapshot.permissions,
    revision: `${user.organizationId}:${user.id}:${user.role}:${snapshot.revision}` };
}

// The key contains the current user, organization, role and role revision. The lifetime
// is only one RSC render or one Request object, so mutations need no unsafe TTL window.
const getPageAuthorization = cache(() => loadAuthorization(getCurrentUser()));
const requestAuthorizations = new WeakMap<Request, ReturnType<typeof loadAuthorization>>();

export function getAuthorizationContext(request?: Request) {
  if (!request) return getPageAuthorization();
  const existing = requestAuthorizations.get(request);
  if (existing) return existing;
  const result = loadAuthorization(getCurrentUserFromRequest(request));
  requestAuthorizations.set(request, result);
  return result;
}
