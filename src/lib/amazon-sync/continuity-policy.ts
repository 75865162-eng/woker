import { digest } from './approval-policy';
import type { SyncScope } from './policy';
export const continuityAction = 'amazon.sync.continuity.enabled';
export const continuitySites = ['ATVPDKIKX0DER', 'A2EUQ1WTGCTBG2', 'A1AM78C64UM0Y8', 'A2Q3Y263D00KWC'];
export function continuityPolicyDigest(value: unknown) {
  const clean = (v: unknown): unknown => Array.isArray(v) ? v.map(clean) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'accessEvidence').map(([k,v]) => [k,clean(v)])) : v;
  return digest(clean(value));
}
export function continuityTargetAllowed(scope: SyncScope, marketplaceId: string, resource: string, environment = process.env.AMAZON_DATA_CENTER_ENVIRONMENT || (process.env.NODE_ENV === "production" ? "production" : "local")) {
  return environment === 'local' && scope.organizationId === 'amazon-live-local' && scope.workspaceId === 'default' && continuitySites.includes(marketplaceId) && ['orders','listing_details','inventory_age'].includes(resource);
}
