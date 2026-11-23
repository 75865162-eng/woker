import { prisma } from "@/lib/db/prisma";
import { amazonImageUrl } from "@/lib/amazon-sync/catalog-images";
import type { SyncScope } from "@/lib/amazon-sync/policy";

/**
 * 商品主档统一装配层（Wimoor 对标 §4.2）。
 *
 * 目标：把散落在 catalog-workbench / attachProductDisplay / brand-products-query 的
 * 「图片 + 标题 + 身份（SKU/ASIN/父 ASIN/变体/品牌/状态）」装配收敛到一个 resolver。
 * 页面表格统一按「图列 → 身份列 → 指标列」消费本层输出。
 *
 * 口径（保持项目既有原则）：
 * - 图片 URL 只走白名单（m.media-amazon.com / images-*.ssl-images-amazon.com），不造 URL；
 * - 缺失字段一律 null，不补零、不猜、不回填；
 * - 每个字段带来源与版本标记，避免多口径冲突；
 * - 只读取数，不写任何主档。
 */

export type ProductIdentityInput = {
  asin?: string | null;
  sellerSku?: string | null;
  marketplaceId?: string | null;
  sellerAccountId?: string | null;
};

export type ProductDisplay = {
  /** 命中的输入 asin（可能是 childAsin） */
  asin: string | null;
  sellerSku: string | null;
  title: string | null;
  imageUrl: string | null;
  parentAsin: string | null;
  brand: string | null;
  listingStatus: string | null;
  fulfillmentType: string | null;
  /** 变体关系：CHILD / PARENT / SINGLE / UNKNOWN（来自快照 listingAttributes，缺失 UNKNOWN） */
  variantRole: "CHILD" | "PARENT" | "SINGLE" | "UNKNOWN";
  /** 字段来源与版本，便于页面标注口径 */
  sources: { title: string | null; image: string | null; identity: string | null };
  capturedAt: string | null;
};

const ASIN_RE = /^[A-Z0-9]{10}$/;
const MAX_ITEMS = 2000;

type CatalogAttrs = {
  itemName?: unknown;
  parentAsin?: unknown;
  brand?: unknown;
  variationParentAsin?: unknown;
  relationshipType?: unknown;
  childAsins?: unknown;
};

function str(value: unknown, max = 300): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** 纯函数：由快照 listingAttributes 提取身份字段。便于单测，无 IO。 */
export function extractIdentityFromAttributes(attributes: unknown): {
  title: string | null; parentAsin: string | null; brand: string | null; variantRole: ProductDisplay["variantRole"];
} {
  const attrs = (attributes && typeof attributes === "object" && !Array.isArray(attributes) ? attributes : {}) as CatalogAttrs;
  const title = str(attrs.itemName, 300);
  const parentAsinRaw = [attrs.parentAsin, attrs.variationParentAsin].map(v => str(v, 10)).find(v => v && ASIN_RE.test(v)) ?? null;
  const brand = str(attrs.brand, 200);
  const relationship = str(attrs.relationshipType, 40)?.toUpperCase() ?? "";
  const children = Array.isArray(attrs.childAsins) ? attrs.childAsins.filter(v => typeof v === "string" && ASIN_RE.test(v)).length : 0;
  let variantRole: ProductDisplay["variantRole"] = "UNKNOWN";
  if (parentAsinRaw) variantRole = "CHILD";
  else if (relationship === "PARENT" || children > 0) variantRole = "PARENT";
  else if (title || brand) variantRole = "SINGLE";
  return { title, parentAsin: parentAsinRaw, brand, variantRole };
}

/**
 * 批量装配：输入商品身份列表（asin 为主键，sku 为辅），返回按 asin 索引的展示数据。
 * - 只处理合法 ASIN，去重、限量；
 * - 标题/身份取最新捕获的 AmazonCatalogSnapshot；
 * - 主图取 AmazonCatalogImageReference(MAIN)，且经白名单校验；
 * - 缺失不造数，返回 null 字段与来源标记。
 */
export async function resolveProductDisplay(
  scope: SyncScope,
  inputs: ProductIdentityInput[],
): Promise<Map<string, ProductDisplay>> {
  const result = new Map<string, ProductDisplay>();
  const asins = [...new Set(inputs.map(i => (i.asin ?? "").trim().toUpperCase()).filter(a => ASIN_RE.test(a)))].slice(0, MAX_ITEMS);
  if (!asins.length) return result;

  // 以 ASIN 索引输入（同 ASIN 多个 SKU 只展示一次，SKU 取第一个非空）
  const inputByAsin = new Map<string, string | null>();
  for (const input of inputs) {
    const asin = (input.asin ?? "").trim().toUpperCase();
    if (!ASIN_RE.test(asin) || inputByAsin.has(asin)) continue;
    inputByAsin.set(asin, str(input.sellerSku, 100));
  }

  const [snapshots, images] = await Promise.all([
    prisma.amazonCatalogSnapshot.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, asin: { in: asins } },
      orderBy: { capturedAt: "desc" },
      select: { asin: true, sellerSku: true, listingAttributes: true, listingStatus: true, fulfillmentType: true, capturedAt: true, sourceRunId: true },
    }),
    prisma.amazonCatalogImageReference.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, asin: { in: asins }, variant: "MAIN" },
      orderBy: { capturedAt: "desc" },
      select: { asin: true, sourceUrl: true, capturedAt: true },
    }),
  ]);

  const snapshotByAsin = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots) if (!snapshotByAsin.has(s.asin)) snapshotByAsin.set(s.asin, s);

  for (const asin of asins) {
    const snapshot = snapshotByAsin.get(asin) ?? null;
    const identity = snapshot ? extractIdentityFromAttributes(snapshot.listingAttributes) : null;
    const image = images.find(i => i.asin === asin && amazonImageUrl(i.sourceUrl));
    const imageUrl = image?.sourceUrl ? amazonImageUrl(image.sourceUrl) : null;
    result.set(asin, {
      asin,
      sellerSku: inputByAsin.get(asin) ?? snapshot?.sellerSku ?? null,
      title: identity?.title ?? null,
      imageUrl,
      parentAsin: identity?.parentAsin ?? null,
      brand: identity?.brand ?? null,
      listingStatus: snapshot?.listingStatus ?? null,
      fulfillmentType: snapshot?.fulfillmentType ?? null,
      variantRole: identity?.variantRole ?? "UNKNOWN",
      sources: {
        title: identity?.title ? `catalog-snapshot:${snapshot?.sourceRunId ?? "unknown"}` : null,
        image: imageUrl ? "catalog-image-reference:MAIN" : null,
        identity: snapshot ? `catalog-snapshot:${snapshot.sourceRunId}` : null,
      },
      capturedAt: (image?.capturedAt ?? snapshot?.capturedAt)?.toISOString() ?? null,
    });
  }
  return result;
}
