import { NextResponse } from 'next/server';
import { requireAmazonReadSession } from '@/lib/auth/amazon-read-session';
import { requireApiPermission } from '@/lib/auth/api-permissions';
import { workspaceScopeFromRequest } from '@/lib/workspace/scope';
import { boundedJsonObject } from '@/lib/amazon-sync/request-body';
import { queryAdsBusinessChanges, mutateAdsBusinessChange } from '@/lib/amazon-ads/change-service';
import { AdsQueryError } from '@/lib/amazon-ads/query-contract';
import { SyncInputError } from '@/lib/amazon-sync/policy';
import { AmazonReadError } from '@/lib/amazon-sync/read-account';
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'no-store' };
function failure(error: unknown) {
  if (error instanceof AdsQueryError || error instanceof SyncInputError || error instanceof AmazonReadError) return NextResponse.json({ error: error.message }, { status: error.status, headers });
  return NextResponse.json({ error: '广告变更服务暂不可用。' }, { status: 503, headers });
}
export async function GET(request: Request) {
  const auth = await requireAmazonReadSession(request); if (!auth.ok) return auth.response;
  try { return NextResponse.json(await queryAdsBusinessChanges({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId }, auth.user.id, new URL(request.url).searchParams), { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const auth = await requireApiPermission('settings', 'edit', request); if (!auth.ok) return auth.response;
  try { return NextResponse.json(await mutateAdsBusinessChange({ organizationId: auth.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId }, auth.user.id, await boundedJsonObject(request, 32 * 1024)), { headers }); } catch (error) { return failure(error); }
}
