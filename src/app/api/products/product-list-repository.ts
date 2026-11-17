import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { mapProductListRow, type ProductListResponse } from "./product-list-query-builders";
import type { ProductListSort } from "@/lib/products/list-sort";

type QueryInput = {
  whereSql: Prisma.Sql;
  sort: ProductListSort;
  page: number;
  pageSize: number;
  hasListFilters: boolean;
};

const sortExpressions = {
  sku: Prisma.sql`COALESCE(s."sku", r."sku")`,
  chineseName: Prisma.sql`COALESCE(s."chineseName", r."chineseName")`,
  createdAt: Prisma.sql`COALESCE(s."createdAt", r."createdAt")`,
  purchasePrice: Prisma.sql`COALESCE(s."purchasePrice", r."purchasePrice")`,
  status: Prisma.sql`COALESCE(s."status", r."status")`,
  supplierName: Prisma.sql`COALESCE(s."supplierName", r."supplierName")`,
} satisfies Record<ProductListSort["field"], Prisma.Sql>;

async function readRecords(whereSql: Prisma.Sql, sort: ProductListSort, page: number, pageSize: number) {
  const direction = Prisma.raw(sort.direction === "asc" ? "ASC" : "DESC");
  return prisma.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT
      r."id" AS "id",
      COALESCE(s."sku", r."sku") AS "sku",
      COALESCE(s."chineseName", r."chineseName") AS "chineseName",
      COALESCE(s."englishName", r."englishName") AS "englishName",
      COALESCE(s."asin", r."asin") AS "asin",
      COALESCE(s."status", r."status") AS "status",
      COALESCE(s."selectionOwner", r."selectionOwner") AS "selectionOwner",
      COALESCE(s."opsAssignee", r."opsAssignee") AS "opsAssignee",
      COALESCE(s."designerAssignee", r."designerAssignee") AS "designerAssignee",
      COALESCE(s."currentOwner", r."currentOwner") AS "currentOwner",
      COALESCE(s."workflowStage", r."workflowStage") AS "workflowStage",
      COALESCE(s."createdAt", r."createdAt") AS "createdAt",
      COALESCE(s."updatedAt", r."updatedAt") AS "updatedAt",
      COALESCE(s."purchasePrice", r."purchasePrice") AS "purchasePrice",
      COALESCE(s."supplierName", r."supplierName") AS "supplierName",
      COALESCE(s."workflowDueAt", r."workflowDueAt") AS "workflowDueAt",
      CASE
        WHEN COALESCE(s."status", r."status") IN ('listed', 'canceled', 'delisted', 'patent_risk') THEN false
        WHEN COALESCE(s."workflowDueAt", r."workflowDueAt") IS NOT NULL THEN COALESCE(s."workflowDueAt", r."workflowDueAt") < NOW()
        ELSE COALESCE(s."createdAt", r."createdAt") < NOW() - INTERVAL '3 days'
      END AS "isOverdue",
      COALESCE(t."specs", r."payload"->>'specs', '') AS "specs",
      COALESCE(t."keywords", r."payload"->>'keywords', '') AS "keywords",
      COALESCE(t."note", r."payload"->>'note', '') AS "note",
      COALESCE(
        CASE WHEN LOWER(LEFT(COALESCE(s."primaryImageUrl", ''), 5)) <> 'data:' THEN NULLIF(s."primaryImageUrl", '') END,
        CASE WHEN LOWER(LEFT(COALESCE(image_asset.asset->>'thumbUrl', ''), 5)) <> 'data:' THEN NULLIF(image_asset.asset->>'thumbUrl', '') END,
        CASE
          WHEN NULLIF(image_asset.asset->>'thumbFileId', '') IS NOT NULL AND LOWER(LEFT(image_asset.asset->>'thumbFileId', 14)) <> 'product-image-' THEN '/api/products/file-assets/' || (image_asset.asset->>'thumbFileId') || '/download'
          WHEN NULLIF(image_asset.asset->>'id', '') IS NOT NULL AND LOWER(LEFT(image_asset.asset->>'id', 14)) <> 'product-image-' THEN '/api/products/file-assets/' || (image_asset.asset->>'id') || '/download'
        END,
        CASE WHEN LOWER(LEFT(COALESCE(image_asset.asset->>'originalUrl', ''), 5)) <> 'data:' THEN NULLIF(image_asset.asset->>'originalUrl', '') END,
        CASE WHEN LOWER(LEFT(COALESCE(r."payload"->>'image', ''), 5)) <> 'data:' THEN NULLIF(r."payload"->>'image', '') END,
        CASE WHEN jsonb_typeof(r."payload"->'images') = 'array' AND LOWER(LEFT(COALESCE(r."payload"#>>'{images,0}', ''), 5)) <> 'data:' THEN NULLIF(r."payload"#>>'{images,0}', '') END,
        ''
      ) AS "image",
      COALESCE(
        CASE WHEN LOWER(LEFT(COALESCE(image_asset.asset->>'thumbFileId', ''), 14)) <> 'product-image-' THEN NULLIF(image_asset.asset->>'thumbFileId', '') END,
        CASE WHEN LOWER(LEFT(COALESCE(image_asset.asset->>'id', ''), 14)) <> 'product-image-' THEN NULLIF(image_asset.asset->>'id', '') END
      ) AS "imageFileId"
    FROM "ProductRecord" r
    LEFT JOIN "ProductSummaryRecord" s
      ON s."productRecordId" = r."id" AND s."organizationId" = r."organizationId"
      AND s."workspaceId" = r."workspaceId" AND s."sourceRevision" = r."revision"
    LEFT JOIN "ProductTextRecord" t
      ON t."productRecordId" = r."id" AND t."organizationId" = r."organizationId"
      AND t."workspaceId" = r."workspaceId" AND t."language" = 'default'
      AND t."sourceRevision" = r."revision"
    LEFT JOIN LATERAL (
      SELECT entries.asset
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."payload"->'imageAssets') = 'array' THEN r."payload"->'imageAssets' ELSE '[]'::jsonb END)
        WITH ORDINALITY AS entries(asset, position)
      WHERE (
        (NULLIF(entries.asset->>'thumbUrl', '') IS NOT NULL AND LOWER(LEFT(entries.asset->>'thumbUrl', 5)) <> 'data:')
        OR (NULLIF(entries.asset->>'thumbFileId', '') IS NOT NULL AND LOWER(LEFT(entries.asset->>'thumbFileId', 14)) <> 'product-image-')
        OR (NULLIF(entries.asset->>'id', '') IS NOT NULL AND LOWER(LEFT(entries.asset->>'id', 14)) <> 'product-image-')
        OR (NULLIF(entries.asset->>'originalUrl', '') IS NOT NULL AND LOWER(LEFT(entries.asset->>'originalUrl', 5)) <> 'data:')
      )
      ORDER BY entries.position LIMIT 1
    ) image_asset ON true
    ${whereSql}
    ORDER BY ${sortExpressions[sort.field]} ${direction}, COALESCE(s."sku", r."sku") ASC, r."id" ASC
    OFFSET ${(page - 1) * pageSize} LIMIT ${pageSize}
  `);
}

async function countRecords(whereSql: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Array<{ count: number | bigint }>>(Prisma.sql`
    SELECT COUNT(*)::int AS "count"
    FROM "ProductRecord" r
    LEFT JOIN "ProductSummaryRecord" s
      ON s."productRecordId" = r."id" AND s."organizationId" = r."organizationId"
      AND s."workspaceId" = r."workspaceId" AND s."sourceRevision" = r."revision"
    LEFT JOIN "ProductTextRecord" t
      ON t."productRecordId" = r."id" AND t."organizationId" = r."organizationId"
      AND t."workspaceId" = r."workspaceId" AND t."language" = 'default'
      AND t."sourceRevision" = r."revision"
    ${whereSql}
  `);
  return Number(rows[0]?.count ?? 0);
}

export async function queryProductListPage(input: QueryInput): Promise<{ products: ProductListResponse["products"]; total?: number }> {
  const recordsPromise = readRecords(input.whereSql, input.sort, input.page, input.pageSize);
  if (!input.hasListFilters) {
    return { products: (await recordsPromise).map(mapProductListRow) };
  }
  const [total, records] = await Promise.all([countRecords(input.whereSql), recordsPromise]);
  return { products: records.map(mapProductListRow), total };
}
