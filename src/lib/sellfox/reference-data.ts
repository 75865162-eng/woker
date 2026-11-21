/**
 * 赛狐引用数据 Reader（店铺 / 站点 / 业务员）。
 *
 * 设计目的（对齐领星 get_my_sids / 赛狐 get_shop_page_list）：
 * 把低频、跨页复用的引用数据从重型 Overview / workbench facets 中剥离，
 * 独立成一次轻量读取，供会话级前端 store 一次加载、全程内存复用。
 *
 * 边界与红线：
 * - 只关联赛狐自己的数据（SellfoxStore + SellfoxProductDailySnapshot），不碰任何 Amazon 模型；
 * - 组织 / 工作区双维度隔离，授权店铺三态由调用方解析后以 visibleStoreIds 传入收窄
 *   （undefined 不收紧 / [] 强制空集 / 具体 id 子集），与 overviewStoreScopeParts 语义一致；
 * - 不臆造：userNameList 为空的记录不计入业务员；marketplace 未收录的站点原样显示 ID；
 * - 不补零：无数据的店铺/站点不出现在选项；缺失字段保留 null；
 * - version 由 store.updatedAt + productDaily.syncedAt 复合，供缓存比对。
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxSiteLabel, siteCodeOf } from "@/lib/sellfox/marketplace-site";

export type Scope = { organizationId: string; workspaceId: string };

export type ReferenceStore = {
  id: string;
  externalId: string;
  name: string;
  marketplace: string;
  country: string;
  status: string;
  lastSyncedAt: string | null;
};
export type ReferenceSite = { marketplace: string; code: string; label: string; storeCount: number };
export type ReferencePerson = { name: string; storeCount: number; stores: string[] };

export type SellfoxReferenceData = {
  stores: ReferenceStore[];
  sites: ReferenceSite[];
  salespersons: ReferencePerson[];
  version: string;
};

export type StoreRow = { id: string; externalId: string; name: string; marketplace: string; country: string; status: string; updatedAt: Date | string; lastSyncedAt?: Date | string | null };
export type TripleRow = { person: string; storeId: string };

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * 纯函数：从店铺名单 + (业务员,店铺) 二元组派生三份引用数据。
 * 与 dimension-analysis 的口径一致：业务员来自 userNameList，空名不计；
 * 站点取店铺实际 marketplace，静态表仅做展示映射，未收录原样显示。
 */
export function buildSellfoxReference(
  storeRows: StoreRow[],
  triples: TripleRow[],
  latestStoreUpdate: string,
  latestDailySync: string,
): SellfoxReferenceData {
  const storeById = new Map(storeRows.map((s) => [s.id, s]));

  // 业务员：只处理能关联到当前可见店铺的二元组，避免暴露无权/未知店铺的业务员。
  const personMap = new Map<string, { stores: Set<string>; externalIds: Set<string> }>();
  for (const row of triples) {
    const name = (row.person ?? "").trim();
    if (!name) continue; // 空名单不计
    const store = storeById.get(row.storeId);
    if (!store) continue;
    let p = personMap.get(name);
    if (!p) { p = { stores: new Set(), externalIds: new Set() }; personMap.set(name, p); }
    p.stores.add(store.id);
    p.externalIds.add(store.externalId);
  }
  const salespersons: ReferencePerson[] = [...personMap.entries()]
    .map(([name, v]) => ({ name, storeCount: v.stores.size, stores: [...v.externalIds].sort() }))
    .sort((a, b) => b.storeCount - a.storeCount || a.name.localeCompare(b.name));

  // 站点：由可见店铺实际出现的 marketplace 去重得到，静态表只做展示映射。
  const siteMap = new Map<string, number>();
  for (const s of storeRows) {
    const mp = (s.marketplace ?? "").trim();
    if (!mp) continue;
    siteMap.set(mp, (siteMap.get(mp) ?? 0) + 1);
  }
  const sites: ReferenceSite[] = [...siteMap.entries()]
    .map(([marketplace, storeCount]) => ({ marketplace, code: siteCodeOf(marketplace), label: sellfoxSiteLabel(marketplace), storeCount }))
    .sort((a, b) => b.storeCount - a.storeCount || a.label.localeCompare(b.label));

  const stores: ReferenceStore[] = storeRows.map((s) => ({
    id: s.id, externalId: s.externalId, name: s.name,
    marketplace: s.marketplace, country: s.country, status: s.status,
    lastSyncedAt: iso(s.lastSyncedAt) || null,
  })).sort((a, b) => a.marketplace.localeCompare(b.marketplace) || a.name.localeCompare(b.name));

  return { stores, sites, salespersons, version: `${latestStoreUpdate}|${latestDailySync}` };
}

/**
 * 轻量版本探测：供 readThroughSellfox 的 loadVersion 使用，避免为判定版本而跑完整 reader。
 * 与 buildSellfoxReference 的 version 口径一致（store.updatedAt|productDaily.syncedAt）。
 */
export async function sellfoxReferenceVersion(
  scope: Scope,
  visibleStoreIds?: string[],
  deps: { prisma?: typeof prisma } = {},
): Promise<string> {
  const db = deps.prisma ?? prisma;
  const org = scope.organizationId;
  const ws = scope.workspaceId;
  if (visibleStoreIds && visibleStoreIds.length === 0) return "__empty__";
  const storeFilter = visibleStoreIds
    ? Prisma.sql`AND "id" IN (${Prisma.join(visibleStoreIds)})`
    : Prisma.empty;
  const [a, b] = await Promise.all([
    db.$queryRaw<Array<{ v: Date | string | null }>>(Prisma.sql`
      SELECT max("updatedAt") AS v FROM "SellfoxStore"
      WHERE "organizationId"=${org} AND "workspaceId"=${ws} ${storeFilter}
    `),
    db.$queryRaw<Array<{ v: Date | string | null }>>(Prisma.sql`
      SELECT max("syncedAt") AS v FROM "SellfoxProductDailySnapshot"
      WHERE "organizationId"=${org} AND "workspaceId"=${ws}
    `),
  ]);
  return `${iso(a[0]?.v)}|${iso(b[0]?.v)}`;
}

/**
 * 读取引用数据。visibleStoreIds 为权限三态；[] 时直接返回空集，绝不回退全量。
 */
export async function readSellfoxReferenceData(
  scope: Scope,
  visibleStoreIds?: string[],
  deps: { prisma?: typeof prisma } = {},
): Promise<SellfoxReferenceData> {
  const db = deps.prisma ?? prisma;
  const org = scope.organizationId;
  const ws = scope.workspaceId;
  if (visibleStoreIds && visibleStoreIds.length === 0) {
    return { stores: [], sites: [], salespersons: [], version: "__empty__" };
  }
  const storeFilter = visibleStoreIds
    ? Prisma.sql`AND st."id" IN (${Prisma.join(visibleStoreIds)})`
    : Prisma.empty;

  const [storeRows, triples, latestStore, latestDaily] = await Promise.all([
    db.$queryRaw<StoreRow[]>(Prisma.sql`
      SELECT st."id", st."externalId", st."name", st.marketplace, st.country, st.status, st."updatedAt", st."lastSyncedAt"
      FROM "SellfoxStore" st
      WHERE st."organizationId"=${org} AND st."workspaceId"=${ws} ${storeFilter}
      ORDER BY st.marketplace, st."name"
    `),
    db.$queryRaw<TripleRow[]>(Prisma.sql`
      SELECT DISTINCT person.name AS person, p."storeId" AS "storeId"
      FROM "SellfoxProductDailySnapshot" p
      JOIN "SellfoxStore" st ON st."id"=p."storeId" AND st."organizationId"=${org} AND st."workspaceId"=${ws} ${storeFilter}
      CROSS JOIN LATERAL unnest(p."userNameList") AS person(name)
      WHERE p."organizationId"=${org} AND p."workspaceId"=${ws}
        AND person.name IS NOT NULL AND length(trim(person.name)) > 0
    `),
    db.$queryRaw<Array<{ v: Date | string | null }>>(Prisma.sql`
      SELECT max(st."updatedAt") AS v FROM "SellfoxStore" st
      WHERE st."organizationId"=${org} AND st."workspaceId"=${ws} ${storeFilter}
    `),
    db.$queryRaw<Array<{ v: Date | string | null }>>(Prisma.sql`
      SELECT max(p."syncedAt") AS v FROM "SellfoxProductDailySnapshot" p
      WHERE p."organizationId"=${org} AND p."workspaceId"=${ws}
    `),
  ]);

  return buildSellfoxReference(storeRows, triples, iso(latestStore[0]?.v), iso(latestDaily[0]?.v));
}
