import type { Tx } from '@/lib/wms/repository';
import type { WmsScope } from '@/lib/wms/contracts';
import { WmsError } from '@/lib/wms/contracts';
import { normalizeRolePermissions } from '@/lib/accounts/role-permissions-utils';
/** Recheck the recorded reviewer when consuming an approval; a stored approval is not authority. */
export async function assertFinanceReviewer(tx: Tx, scope: WmsScope, userId: string) {
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${scope.organizationId} FOR SHARE`;
  const rows = await tx.$queryRaw<Array<{ permissions: unknown }>>`
    SELECT r.permissions FROM "OrganizationMember" m
    JOIN "User" u ON u.id=m."userId"
    JOIN "OrganizationRosterRole" r ON r.id=m.role::text AND r."organizationId"=m."organizationId"
    WHERE m."organizationId"=${scope.organizationId} AND m."userId"=${userId} AND u.status='active'
    FOR SHARE OF m,u,r`;
  const rosterRows=await tx.$queryRaw<Array<{status:string}>>`SELECT status::text AS status FROM "TeamRosterMember" WHERE "organizationId"=${scope.organizationId} AND id=${userId} FOR SHARE`;
  const roster=rosterRows[0];
  if (!rows[0] || (roster && roster.status !== 'active') || !normalizeRolePermissions(rows[0].permissions).operations?.includes('approve')) throw new WmsError('关账复核人已停用、撤权或不属于当前组织。', 403);
}

/** Hold current membership, user, roster and role authority until the write commits. */
export async function assertFinanceAction(tx:Tx,scope:WmsScope,action:'view'|'create'|'approve'){
 await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${scope.organizationId} FOR SHARE`;
 const rows=await tx.$queryRaw<Array<{permissions:unknown}>>`SELECT r.permissions FROM "OrganizationMember" m JOIN "User" u ON u.id=m."userId" JOIN "OrganizationRosterRole" r ON r.id=m.role::text AND r."organizationId"=m."organizationId" WHERE m."organizationId"=${scope.organizationId} AND m."userId"=${scope.actorUserId} AND u.status='active' FOR SHARE OF m,u,r`;
 const roster=await tx.$queryRaw<Array<{status:string}>>`SELECT status::text AS status FROM "TeamRosterMember" WHERE "organizationId"=${scope.organizationId} AND id=${scope.actorUserId} FOR SHARE`;
 if(!rows[0]||(roster[0]&&roster[0].status!=='active')||!normalizeRolePermissions(rows[0].permissions).operations?.includes(action))throw new WmsError('当前成员已停用、撤权或无此财务操作权限。',403);
 if(!await tx.workspaceScope.findUnique({where:{organizationId_id:{organizationId:scope.organizationId,id:scope.workspaceId}},select:{id:true}}))throw new WmsError('工作区不存在。',403);
}
