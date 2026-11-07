import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import type { SellfoxBrowseQuery } from "./browse-query";
import { sellfoxStoreSyncFailures } from "./sync-failures";

type Scope = { organizationId: string; workspaceId: string };
type Line = Prisma.SellfoxFbaShipmentSnapshotGetPayload<{ include: { SellfoxStore: { select: { name: true; marketplace: true } } } }>;

function sum(values: Array<number | null>) {
  return values.some((value) => value == null) ? null : values.reduce<number>((total, value) => total + Number(value), 0);
}

export function shipmentApiRows(lines: Line[]) {
  const groups = new Map<string, Line[]>();
  for (const line of lines) groups.set(`${line.storeId}\u0000${line.shipmentId}`, [...(groups.get(`${line.storeId}\u0000${line.shipmentId}`) ?? []), line]);
  return [...groups.values()].map((items) => {
    const first = items[0];
    const statuses = new Set(items.map((item) => item.status));
    const mskus = new Set(items.map((item) => item.msku).filter(Boolean));
    return {
      id: `${first.storeId}:${first.shipmentId}`,
      store: [first.SellfoxStore.name, first.SellfoxStore.marketplace].filter(Boolean).join(" / "),
      name: first.shipmentName,
      marketplace: first.SellfoxStore.marketplace,
      shopExternalId: first.shopExternalId,
      shipmentId: first.shipmentId,
      shipmentName: first.shipmentName,
      status: statuses.size === 1 ? first.status : null,
      createdAt: first.sourceCreatedAt,
      shippedAt: first.shippedAt,
      mskuCount: mskus.size,
      declared: sum(items.map((item) => item.declaredQty)),
      shipped: sum(items.map((item) => item.shippedQty)),
      received: sum(items.map((item) => item.receivedQty)),
      fc: first.fulfillmentCenterId,
    };
  }).sort((left, right) => String(right.createdAt ?? "").localeCompare(String(left.createdAt ?? "")) || left.shipmentId.localeCompare(right.shipmentId));
}

export async function readSellfoxShipments(query: SellfoxBrowseQuery, scope: Scope, storeIds?: string[]) {
  const searchField = query.searchType === "shipment" ? "shipmentId" : query.searchType === "asin" ? "asin" : query.searchType === "msku" ? "msku" : "";
  const match = query.exactMatch ? { equals: query.search, mode: "insensitive" as const } : { contains: query.search, mode: "insensitive" as const };
  const where: Prisma.SellfoxFbaShipmentSnapshotWhereInput = {
    organizationId: scope.organizationId,
    workspaceId: scope.workspaceId,
    ...(storeIds ? { storeId: { in: storeIds } } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to ? { sourceCreatedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: `${query.to} 23:59:59` } : {}) } } : {}),
    ...(query.site ? { SellfoxStore: { marketplace: query.site } } : {}),
    ...(query.search ? searchField
      ? { [searchField]: match }
      : { OR: ["shipmentId", "shipmentName", "asin", "msku", "sku"].map((field) => ({ [field]: match })) }
      : {}),
  };
  // Current capture only: head.capturedAt equals the line's latestCapturedAt.
  const [lines, failures] = await Promise.all([
    prisma.sellfoxFbaShipmentSnapshot.findMany({
      where,
      include: { SellfoxStore: { select: { name: true, marketplace: true, SellfoxSnapshotHead: { where: { resource: "fba_shipments" }, select: { capturedAt: true } } } } },
    }),
    sellfoxStoreSyncFailures("fba_shipments", scope),
  ]);
  const current = lines.filter((line) => line.SellfoxStore.SellfoxSnapshotHead.some((head) => head.capturedAt.getTime() === line.latestCapturedAt.getTime()));
  const grouped = shipmentApiRows(current.map(({ SellfoxStore, ...line }) => ({ ...line, SellfoxStore: { name: SellfoxStore.name, marketplace: SellfoxStore.marketplace } })));
  const start = (query.page - 1) * query.pageSize;
  return {
    rows: grouped.slice(start, start + query.pageSize),
    totals: [{ declared: grouped.every((row) => row.declared != null) && grouped.length ? grouped.reduce((sum, row) => sum + Number(row.declared), 0) : null }],
    facets: { productTags: [] as string[], salespersons: [] as string[], statuses: [...new Set(grouped.map((row) => row.status).filter((status): status is string => Boolean(status)))].sort() },
    pagination: { page: query.page, pageSize: query.pageSize, total: grouped.length },
    failures,
  };
}
