import type { Prisma } from '@prisma/client';
import type { Product } from './types';
import type { ProductRecordScope } from './product-record-repository';
import { amazonDataAccess } from '@/lib/amazon-sync/data-access';
import { assertProductCompositionAcyclic, parseProductManagement, ProductManagementError } from './management-contract';

export async function validateProductManagement(tx: Prisma.TransactionClient, input: { product: Product; existing?: Partial<Product>; scope: ProductRecordScope; actor: string }) {
  const value = input.product.management ?? input.existing?.management;
  if (!value) return input.product;
  const management = parseProductManagement(value), scope = { organizationId: input.scope.organizationId, workspaceId: input.scope.workspaceId };
  // Serialize graph edits across products, including two concurrent A->B / B->A writes.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['product-management', scope])}, 0))`;
  for (const [kind, id] of [['BRAND', management.brandId], ['CATEGORY', management.categoryId]] as const) {
    if (id && !await tx.productCatalogEntry.findFirst({ where: { ...scope, id, kind, enabled: true }, select: { id: true } })) throw new ProductManagementError('品牌或分类不存在、已停用或不属于当前工作区。');
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
    const access = await amazonDataAccess(scope, input.actor, tx);
    for (const row of management.listingIdentifiers) {
      if (!access.allSellers && !access.sellerIds.includes(row.sellerAccountId)) throw new ProductManagementError('商品标识的卖家账号未授权。', 403);
      const binding = await tx.amazonSellerBinding.findFirst({ where: { ...scope, sellerAccountId: row.sellerAccountId, marketplaceId: row.marketplaceId }, select: { id: true } });
      if (!binding) throw new ProductManagementError('商品标识没有有效的卖家/站点绑定。', 403);
    }
  }
  return { ...input.product, management, ...(primary ? { supplierName: suppliers.find(row => row.id === primary.supplierId)!.name, supplierUrl: primary.productUrl, purchaseLeadTime: primary.purchaseLeadTime } : {}) };
}
