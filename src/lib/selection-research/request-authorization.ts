import type { ApiPermissionResult } from "@/lib/auth/api-permissions";
import type { PermissionAction } from "@/lib/accounts/permissions";

type Authorization = {
  credentialId: string;
  authorize: (moduleId: string, action: PermissionAction, request: Request) => Promise<ApiPermissionResult>;
};
// Server-owned request identity only. Headers, cookies and cloned Requests cannot bind it.
const verifiedRequests = new WeakMap<Request, Authorization>();
export function researchRequestAuthorization(request: Request) { return verifiedRequests.get(request); }
export async function withResearchRequestAuthorization<T>(request: Request, authorization: Authorization, execute: () => Promise<T>): Promise<T> {
  if (!/^\/api\/selection-research(?:\/[A-Za-z0-9_-]+)?$/.test(new URL(request.url).pathname) || verifiedRequests.has(request)) throw new Error("RESEARCH_SCOPE_DENIED");
  verifiedRequests.set(request, authorization);
  try { return await execute(); }
  finally { verifiedRequests.delete(request); }
}
