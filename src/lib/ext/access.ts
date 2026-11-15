/**
 * 功能补全域的访问控制薄封装：复用 WMS 的组织/工作区校验与审计表，
 * 只把审计动作前缀换成 erp.ext.*，避免和仓库命令混在一起。
 */
import type { Prisma } from '@prisma/client';
import { authorizeWms, json, scoped } from '@/lib/wms/access';
import type { PermissionAction } from '@/lib/accounts/permissions';
import type { WmsScope } from '@/lib/wms/contracts';

export { json, scoped };

export async function authorizeEntity(tx: Prisma.TransactionClient, scope: WmsScope, action: PermissionAction) {
  await authorizeWms(tx, scope, action);
}

export async function auditEntity(
  tx: Prisma.TransactionClient,
  scope: WmsScope,
  action: string,
  entityId: string,
  metadata: Prisma.InputJsonValue = {},
) {
  await tx.auditLog.create({
    data: {
      organizationId: scope.organizationId,
      userId: scope.actorUserId,
      action: `erp.ext.${action}`,
      entityType: 'ERP_EXT',
      entityId,
      metadata: { workspaceId: scope.workspaceId, detail: metadata },
    },
  });
}
