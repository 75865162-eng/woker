import type { SyncScope } from "./policy";

/** Optional operator boundary. Absence means discover authorized tenants from
 * PostgreSQL; an explicit empty or invalid list remains fail-closed.
 * This is not an RBAC grant: every source/plan still checks its current actor.
 */
export function configuredSyncScopes(value: string | undefined): SyncScope[] | null {
  if (value === undefined) return null;
  try {
    const rows: unknown = JSON.parse(value);
    if (!Array.isArray(rows) || rows.some(row => !Array.isArray(row) || row.length !== 2 || row.some(v => typeof v !== "string" || !v.trim() || v.trim() !== v || v === "*" || v.length > 200))) return [];
    const scopes = rows.map(row => ({ organizationId: row[0] as string, workspaceId: row[1] as string }));
    return scopes.filter((s, i) => scopes.findIndex(other => other.organizationId === s.organizationId && other.workspaceId === s.workspaceId) === i);
  } catch { return []; }
}

export function syncScopeAllowed(scope: SyncScope, value: string | undefined): boolean {
  if (!scope.organizationId || !scope.workspaceId || scope.organizationId === "*" || scope.workspaceId === "*") return false;
  const configured = configuredSyncScopes(value);
  return configured === null || configured.some(s => s.organizationId === scope.organizationId && s.workspaceId === scope.workspaceId);
}
