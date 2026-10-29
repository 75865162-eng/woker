import { Prisma } from "@prisma/client";
import { SellfoxBrowseError, type SellfoxBrowseQuery } from "./browse-query";
import { sellfoxSortColumns } from "./sort-columns";

/** Return the allowlist's constant, never a request string for a SQL identifier. */
export function sellfoxSortKey(domain: string, query: Pick<SellfoxBrowseQuery, "sortBy" | "sortOrder">) {
  if (!query.sortBy) return undefined;
  const key = Object.hasOwn(sellfoxSortColumns, domain) ? sellfoxSortColumns[domain].find(key => key === query.sortBy) : undefined;
  if (!key || !["asc", "desc"].includes(query.sortOrder)) throw new SellfoxBrowseError("当前域不支持该排序列或方向。");
  return key;
}
export function sellfoxSqlOrder(query: Pick<SellfoxBrowseQuery, "sortOrder">, expression: Prisma.Sql) {
  return Prisma.sql`${expression} ${query.sortOrder === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`} NULLS LAST, id ASC`;
}

type SortModels = {
  stores: Prisma.SellfoxStoreOrderByWithRelationInput;
  inventory: Prisma.SellfoxFbaInventorySnapshotOrderByWithRelationInput;
  hourly: Prisma.SellfoxHourlyMetricOrderByWithRelationInput;
  runs: Prisma.SellfoxSyncRunOrderByWithRelationInput;
};
export function sellfoxPrismaOrder<D extends keyof SortModels>(domain: D, query: SellfoxBrowseQuery): SortModels[D][] {
  const key = sellfoxSortKey(domain, query);
  const defaults = {
    stores: [{ name: "asc" }, { id: "asc" }],
    inventory: [{ capturedAt: "desc" }, { asin: "asc" }, { id: "asc" }],
    hourly: [{ reportDate: "desc" }, { hour: "desc" }, { id: "asc" }],
    runs: [{ startedAt: "desc" }, { id: "asc" }],
  };
  const order = !key ? defaults[domain] : [
    (domain === "inventory" || domain === "hourly") && ["name", "marketplace"].includes(key)
      ? { SellfoxStore: { [key]: query.sortOrder } }
      : { [key]: query.sortOrder },
    { id: "asc" },
  ];
  // Fields and relation names above come exclusively from the per-model allowlist.
  return order as SortModels[D][];
}
