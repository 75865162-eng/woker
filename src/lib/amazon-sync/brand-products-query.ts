import { prisma } from "@/lib/db/prisma";
import { sourceAccessWhere, type AmazonDataAccess } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";
import { brandProductMetadata, type BrandProductLink } from "./brand-product-links";
import { readProductImageReferences } from "@/lib/operations/amazon-product-images";

type Source = { authorizationId: string; authorization: { revision: number }; sellerAccountId: string; marketplaceId: string };
/** Page-bounded join against published Amazon read data; no external fetch or master-data write. */
export async function readBrandProducts(scope: SyncScope, source: Source, values: string[], access: AmazonDataAccess) {
  const asins = [...new Set(values)];
  if (asins.length > 100 || asins.some(asin => !/^[A-Z0-9]{10}$/.test(asin))) throw new SyncInputError("商品关联范围无效。", 422);
  const products: Record<string, BrandProductLink> = Object.fromEntries(asins.map(asin => [asin, { asin, skus: [], title: null, brand: null, thumbnailUrl: null, catalogRunId: null, capturedAt: null, detailRunIds: [] }]));
  const warnings: string[] = [];
  if (!asins.length) return { products, warnings };
  const target = { sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId };
  const heads = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, ...sourceAccessWhere(access), ...target, authorizationId: source.authorizationId, enabled: true, resource: { in: ["catalog", "listing_details", "catalog_items"] }, publishedRun: { executionVersion: 2, status: "SUCCEEDED", finishedAt: { not: null }, stage: { not: "PURGED" } } },
    select: { id: true, revision: true, resource: true, activeRunId: true, coverage: true, publishedRun: { select: { frozenScope: true } } }, orderBy: { resource: "asc" } });
  const current = heads.filter(head => {
    const frozen = head.publishedRun?.frozenScope as Record<string, unknown> | null;
    return frozen?.authorizationId === source.authorizationId && frozen.authorizationRevision === source.authorization.revision && frozen.sourceRevision === head.revision;
  });
  const catalog = current.find(head => head.resource === "catalog" && (head.coverage as { type?: string; paginationComplete?: boolean } | null)?.type === "complete_snapshot" && (head.coverage as { paginationComplete?: boolean }).paginationComplete === true);
  const detailHeads = current.filter(head => head.resource !== "catalog");
  const [rows, details] = await Promise.all([
    catalog ? prisma.amazonCatalogSnapshot.findMany({ where: { ...scope, ...target, sourceRunId: catalog.activeRunId!, asin: { in: asins } }, select: { asin: true, sellerSku: true, capturedAt: true }, orderBy: { sellerSku: "asc" }, take: 4001 }) : [],
    detailHeads.length ? prisma.amazonDomainObservation.findMany({ where: { ...scope, asin: { in: asins }, OR: detailHeads.map(head => ({ sourceId: head.id, sourceRunId: head.activeRunId!, kind: head.resource === "catalog_items" ? "CATALOG_DETAIL" : "LISTING_DETAIL" })) }, select: { asin: true, facts: true, sourceRunId: true, sourceId: true }, orderBy: { id: "asc" }, take: 4001 }) : [],
  ]);
  if (rows.length > 4000 || details.length > 4000) throw new SyncInputError("商品资料关联超出单页容量，请缩小 ASIN 范围。", 409);
  if (!catalog) warnings.push("没有同授权版本的完整商品快照；关联 SKU 未知。");
  for (const row of rows) { const product = products[row.asin]; product.skus.push(row.sellerSku); product.catalogRunId = catalog!.activeRunId; product.capturedAt = row.capturedAt.toISOString(); }
  // Conflicting listing metadata stays unknown; catalog-item metadata takes
  // precedence when available. Never choose an arbitrary SKU's brand.
  for (const resource of ["listing_details", "catalog_items"]) for (const asin of asins) {
    const matches = details.filter(row => row.asin === asin && detailHeads.some(head => head.id === row.sourceId && head.resource === resource));
    const metadata = matches.map(row => brandProductMetadata(row.facts, source.marketplaceId));
    const product = products[asin];
    for (const field of ["title", "brand"] as const) {
      const values = [...new Set(metadata.map(row => row[field]).filter((v): v is string => !!v))];
      if (values.length === 1) product[field] = values[0];
      if (values.length > 1) { product[field] = null; warnings.push(`${asin} 的商品${field === "brand" ? "品牌" : "标题"}存在冲突，未自动选择。`); }
    }
    for (let i = 0; i < matches.length; i++) if ((metadata[i].title || metadata[i].brand) && !product.detailRunIds.includes(matches[i].sourceRunId)) product.detailRunIds.push(matches[i].sourceRunId);
  }
  // Optional image capability is checked without issuing a failing table read.
  const [imageCapability] = await prisma.$queryRaw<Array<{ ready: boolean }>>`SELECT to_regclass('"AmazonCatalogImageReference"') IS NOT NULL AND to_regclass('"AmazonCatalogImageBlob"') IS NOT NULL AS ready`;
  if (imageCapability?.ready) {
    const images = await readProductImageReferences(scope, asins.map(asin => ({ ...target, asin })));
    for (const image of images) products[image.asin].thumbnailUrl = `/api/operations/products/images/${encodeURIComponent(image.fileId)}?workspaceId=${encodeURIComponent(scope.workspaceId)}`;
  } else warnings.push("商品主图存储尚未就绪；品牌指标仍可查看。");
  return { products, warnings };
}
