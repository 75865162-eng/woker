import type { Prisma } from '@prisma/client';
import type { Product } from './types';
import type { ProductRecordScope } from './product-record-repository';
import { prisma } from '@/lib/db/prisma';
import { SyncInputError } from '@/lib/amazon-sync/policy';
import { amazonDataAccess } from '@/lib/amazon-sync/data-access';
import { assertProductCompositionAcyclic, parseProductManagement, ProductManagementError } from './management-contract';

export async function validateProductManagement(tx: Prisma.TransactionClient, input: { product: Product; existing?: Partial<Product>; scope: ProductRecordScope; actor: string }) {
  const value = input.product.management ?? input.existing?.management;
  if (!value) return input.product;
  const management = parseProductManagement(value), scope = { organizationId: input.scope.organizationId, workspaceId: input.scope.workspaceId };
  // Serialize graph edits across products, including two concurrent A->B / B->A writes.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['product-management', scope])}, 0))`;
  for (const [kind, id] of [['BRAND', management.brandId], ['CATEGORY', management.categoryId]] as const) {
    const previousId = kind === 'BRAND' ? input.existing?.management?.brandId : input.existing?.management?.categoryId;
    if (id && !await tx.productCatalogEntry.findFirst({ where: { ...scope, id, kind, ...(previousId === id ? {} : { enabled: true }) }, select: { id: true } })) throw new ProductManagementError('品牌或分类不存在、已停用或不属于当前工作区。');
  }
  const primary = management.suppliers.find(row => row.isPrimary);
  const suppliers = await tx.supplier.findMany({ where: { organizationId: scope.organizationId, id: { in: management.suppliers.map(row => row.supplierId) } }, select: { id: true, name: true } });
  if (suppliers.length !== management.suppliers.length) throw new ProductManagementError('供应商不存在或不属于当前组织。');
  const existing = await tx.productRecord.findFirst({ where: { ...scope, sku: input.product.sku }, select: { id: true } });
  const root = existing?.id ?? input.product.id;
  const graph = new Map<string, string[]>([[root, management.components.map(row => row.productRecordId)]]);
  let frontier = graph.get(root)!;
  const visited = new Set([root]);
  for (let depth = 0; frontier.length; depth++) {
    if (depth > 50 || visited.size + frontier.length > 5000) throw new ProductManagementError('组合关系超过可验证范围。');
    const ids = [...new Set(frontier.filter(id => !visited.has(id)))];
    if (!ids.length) break;
    const products = await tx.productRecord.findMany({ where: { ...scope, id: { in: ids } }, select: { id: true, payload: true } });
    if (products.length !== ids.length) throw new ProductManagementError('组合品包含不存在或其他工作区的子商品。');
    frontier = [];
    for (const product of products) {
      visited.add(product.id);
      const payload = product.payload as unknown as Partial<Product>;
      const children = payload.management ? parseProductManagement(payload.management).components.map(row => row.productRecordId) : [];
      graph.set(product.id, children); frontier.push(...children);
    }
  }
  assertProductCompositionAcyclic(root, graph);
  if (management.listingIdentifiers.length) {
    const access = await amazonDataAccess(scope, input.actor, tx).catch(error => { if (error instanceof SyncInputError) throw new ProductManagementError(error.message, error.status); throw error; });
    for (const row of management.listingIdentifiers) {
      if (!access.allSellers && !access.sellerIds.includes(row.sellerAccountId)) throw new ProductManagementError('商品标识的卖家账号未授权。', 403);
      const binding = await tx.amazonSellerBinding.findFirst({ where: { ...scope, sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId }, select: { id: true } });
      if (!binding) throw new ProductManagementError('商品标识没有有效的卖家/站点绑定。', 403);
    }
  }
  return { ...input.product, management, ...(primary ? { supplierName: suppliers.find(row => row.id === primary.supplierId)!.name, supplierUrl: primary.productUrl, purchaseLeadTime: primary.purchaseLeadTime } : input.existing?.management?.suppliers.length ? { supplierName: '', supplierUrl: '', purchaseLeadTime: '' } : {}) };
}

/** Authorized local bindings for product identifier editing; never claims Listing publication. */
export async function queryProductListingChoices(scope: { organizationId: string; workspaceId: string }, actor: string) {
  return prisma.$transaction(async tx => {
    let access;
    try { access = await amazonDataAccess(scope, actor, tx); }
    catch (error) { if (error instanceof SyncInputError && error.status === 403) return []; throw error; }
    const sellers = await tx.sellerAccount.findMany({ where: { ...scope, id: { in: access.sellerIds }, status: 'active' }, select: { id: true, displayName: true }, take: 201 });
    if (sellers.length > 200) throw new ProductManagementError('授权店铺超过可选择范围。');
    const bindings = await tx.amazonSellerBinding.findMany({ where: { ...scope, sellerAccountId: { in: sellers.map(row => row.id) } }, select: { sellerAccountId: true, marketplaceId: true }, orderBy: [{ sellerAccountId: 'asc' }, { marketplaceId: 'asc' }], take: 1001 });
    if (bindings.length > 1000) throw new ProductManagementError('授权站点超过可选择范围。');
    return bindings.map(row => ({ ...row, sellerName: sellers.find(seller => seller.id === row.sellerAccountId)!.displayName }));
  });
}
