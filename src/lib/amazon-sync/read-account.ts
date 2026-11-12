import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, type AmazonDataAccess } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";

export class AmazonReadError extends SyncInputError {
  constructor(public readonly businessCode: "AMAZON_AUTHORIZATION_INVALID" | "DATA_SOURCE_NOT_CONFIGURED" | "ACCOUNT_SCOPE_REQUIRED", message: string, status = 409) {
    super(message, status);
  }
}

/** One account per business read, including requests made directly to ERP services.
 * Source selectors are resolved under the same tenant and live user assignment.
 * Official authorization state is checked locally; this never contacts Amazon.
 */
export async function amazonAccountReadAccess(scope: SyncScope, actor: string | undefined, params: URLSearchParams, db: Prisma.TransactionClient = prisma, resource?: string): Promise<AmazonDataAccess> {
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const access = await amazonDataAccess(scope, actor, db);
  if (params.has("sellerAccountIds") || ["sellerAccountId", "sourceId", "marketplaceId"].some(key => params.getAll(key).length > 1)) {
    throw new AmazonReadError("ACCOUNT_SCOPE_REQUIRED", "每次查询只能选择一个 Amazon 账号。", 400);
  }
  let sellerAccountId = params.get("sellerAccountId") || undefined;
  const sourceId = params.get("sourceId");
  if (sellerAccountId && !access.sellerIds.includes(sellerAccountId)) throw new SyncInputError("Amazon 账号未分配给当前用户。", 403);
  if (sourceId) {
    const source = await db.amazonSyncDataSource.findFirst({ where: { ...scope, id: sourceId, sellerAccountId: { in: access.sellerIds } }, select: { sellerAccountId: true } });
    if (!source || sellerAccountId && source.sellerAccountId !== sellerAccountId) throw new SyncInputError("数据源不属于当前账号。", 403);
    sellerAccountId = source.sellerAccountId;
  }
  if (!sellerAccountId && access.sellerIds.length === 1) sellerAccountId = access.sellerIds[0];
  if (!sellerAccountId) throw new AmazonReadError("ACCOUNT_SCOPE_REQUIRED", "请选择单个 Amazon 账号后查询。", 400);
  const sources = await db.amazonSyncDataSource.findMany({ where: { ...scope, sellerAccountId,
    ...(sourceId ? { id: sourceId } : {}), ...(resource ? { resource } : {}),
    ...(params.get("marketplaceId") && resource !== "finance" ? { marketplaceId: params.get("marketplaceId")! } : {}),
  }, select: { authorization: { select: { status: true, identityVerifiedAt: true } } }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("查询来源超过安全上限。", 409);
  if (!sources.length) throw new AmazonReadError("DATA_SOURCE_NOT_CONFIGURED", "当前账号尚未接入请求的数据来源。");
  if (sources.some(source => source.authorization.status !== "CONFIGURED" || !source.authorization.identityVerifiedAt)) {
    throw new AmazonReadError("AMAZON_AUTHORIZATION_INVALID", "Amazon 官方授权已失效或尚未验证，请重新连接该账号。");
  }
  return { allSellers: false, sellerIds: [sellerAccountId] };
}
