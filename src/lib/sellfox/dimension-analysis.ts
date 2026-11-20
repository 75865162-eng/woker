import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxMarketplaceSites } from "@/lib/sellfox/marketplace-site";

/**
 * 赛狐维度分析只读数据层。
 *
 * 目的：为「业务员 / 店铺 / 站点」三个维度提供「名单 + 关联清单」，
 * 不依赖业务页的下拉选项（下拉选项为空时这里仍能直接列出全部实体）。
 *
 * 边界（遵循赛狐隔离原则）：
 * - 只关联赛狐自己的数据：SellfoxStore + SellfoxProductDailySnapshot；
 *   不与 Amazon 任何模型互通，相近字段一律保持 sellfox 口径。
 * - 组织 / 工作区双维度隔离；可见店铺权限在调用方解析后以 storeIds 传入收窄。
 * - 只列名单与关联关系，不汇总金额/数量等经营指标（口径由用户拍板）。
 * - 不臆造：userNameList 为空的记录不计入业务员名单；marketplace 未收录则原样显示 ID。
 */

export type Dimension = "salesperson" | "store" | "site";
export const DIMENSIONS: Dimension[] = ["salesperson", "store", "site"];
export function isDimension(value: unknown): value is Dimension {
  return typeof value === "string" && (DIMENSIONS as string[]).includes(value);
}

type Scope = { organizationId: string; workspaceId: string };

export type StoreLink = { storeId: string; externalId: string; name: string; marketplace: string };
export type PersonLink = { name: string; storeCount: number; mskuCount: number; stores: StoreLink[]; sites: string[] };
export type SiteLink = { marketplace: string; code: string; label: string; storeCount: number; personCount: number; mskuCount: number; stores: StoreLink[]; people: string[] };
export type StorePersonView = {
  externalId: string; name: string; marketplace: string; code: string; label: string;
  country: string; status: string; personCount: number; mskuCount: number; people: string[];
};

export type DimensionAnalysis = {
  dimension: Dimension;
  salespeople: PersonLink[];
  stores: StorePersonView[];
  sites: SiteLink[];
  coverage: { stores: number; people: number; sites: number; snapshotRows: number };
};

function siteMeta(marketplace: string) {
  const found = sellfoxMarketplaceSites[marketplace];
  return { code: found?.code ?? marketplace, label: found?.label ?? marketplace };
}

/**
 * 一次读取预算内全量的 (person, storeId, msku) 关联三元组，再在内存里派生三个维度。
 * 用 DISTINCT 三元组，避免快照按日重复放大名单；storeId 用 join 校验归属与可见范围。
 */
export async function readDimensionAnalysis(scope: Scope, visibleStoreIds?: string[]): Promise<DimensionAnalysis> {
  const org = scope.organizationId;
  const ws = scope.workspaceId;
  // 空集可见店铺：直接返回空名单，不回退全量。
  if (visibleStoreIds && visibleStoreIds.length === 0) {
    return { dimension: "salesperson", salespeople: [], stores: [], sites: [], coverage: { stores: 0, people: 0, sites: 0, snapshotRows: 0 } };
  }
  const storeFilter = visibleStoreIds
    ? Prisma.sql`AND st."id" IN (${Prisma.join(visibleStoreIds)})`
    : Prisma.empty;

  // 店铺名单（按可见范围收窄）。
  const storeRows = await prisma.$queryRaw<Array<{ id: string; externalId: string; name: string; marketplace: string; country: string; status: string }>>(Prisma.sql`
    SELECT st."id", st."externalId", st."name", st.marketplace, st.country, st.status
    FROM "SellfoxStore" st
    WHERE st."organizationId"=${org} AND st."workspaceId"=${ws} ${storeFilter}
    ORDER BY st.marketplace, st."name"
  `);
  // 关联三元组：CROSS JOIN LATERAL unnest 只展开业务员数组（一人多行但不去重会放大），
  // 之后 DISTINCT 收敛到 (person, storeId, msku)。storeId 只保留当前可见店铺。
  const triples = await prisma.$queryRaw<Array<{ person: string; storeId: string; msku: string }>>(Prisma.sql`
    SELECT DISTINCT person.name AS person, p."storeId" AS "storeId", p.msku AS msku
    FROM "SellfoxProductDailySnapshot" p
    JOIN "SellfoxStore" st ON st."id"=p."storeId" AND st."organizationId"=${org} AND st."workspaceId"=${ws} ${storeFilter}
    CROSS JOIN LATERAL unnest(p."userNameList") AS person(name)
    WHERE p."organizationId"=${org} AND p."workspaceId"=${ws}
      AND person.name IS NOT NULL AND length(trim(person.name)) > 0
  `);
  // 快照行数（覆盖度展示，不参与名单口径）。
  const snapshotRows = await prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
    SELECT count(*)::bigint AS n FROM "SellfoxProductDailySnapshot" p
    JOIN "SellfoxStore" st ON st."id"=p."storeId" AND st."organizationId"=${org} AND st."workspaceId"=${ws} ${storeFilter}
    WHERE p."organizationId"=${org} AND p."workspaceId"=${ws}
  `);

  return buildDimensionAnalysis(storeRows, triples, Number(snapshotRows[0]?.n ?? 0));
}

export type DimensionStoreRow = { id: string; externalId: string; name: string; marketplace: string; country: string; status: string };
export type DimensionTriple = { person: string; storeId: string; msku: string };

/** 纯函数：从店铺名单 + (业务员,店铺,商品) 三元组派生三维名单与关联，便于单测。 */
export function buildDimensionAnalysis(storeRows: DimensionStoreRow[], triples: DimensionTriple[], snapshotRowCount: number): DimensionAnalysis {
  const storeById = new Map(storeRows.map((s) => [s.id, s]));
  const storeLinks = (id: string): StoreLink | null => {
    const s = storeById.get(id);
    return s ? { storeId: s.id, externalId: s.externalId, name: s.name, marketplace: s.marketplace } : null;
  };

  // 业务员 → 店铺 / 站点 / 商品
  const personMap = new Map<string, { stores: Map<string, StoreLink>; sites: Set<string>; mskus: Set<string> }>();
  // 店铺 → 业务员 / 商品
  const storeMap = new Map<string, { people: Set<string>; mskus: Set<string> }>();
  // 站点 → 店铺 / 业务员 / 商品；站点骨架先由全部店铺建立，即使暂无业务员关联也列名。
  const siteMap = new Map<string, { stores: Map<string, StoreLink>; people: Set<string>; mskus: Set<string> }>();
  for (const s of storeRows) {
    if (!siteMap.has(s.marketplace)) siteMap.set(s.marketplace, { stores: new Map(), people: new Set(), mskus: new Set() });
    siteMap.get(s.marketplace)!.stores.set(s.id, { storeId: s.id, externalId: s.externalId, name: s.name, marketplace: s.marketplace });
  }

  for (const row of triples) {
    const person = row.person.trim();
    // 只处理关联到可见店铺的三元组：避免把无权/未知店铺的业务员暴露进名单。
    const link = storeLinks(row.storeId);
    if (!link) continue;
    const msku = (row.msku ?? "").trim();

    let p = personMap.get(person);
    if (!p) { p = { stores: new Map(), sites: new Set(), mskus: new Set() }; personMap.set(person, p); }
    p.stores.set(link.storeId, link);
    p.sites.add(link.marketplace);
    if (msku) p.mskus.add(msku);

    let s = storeMap.get(row.storeId);
    if (!s) { s = { people: new Set(), mskus: new Set() }; storeMap.set(row.storeId, s); }
    s.people.add(person);
    if (msku) s.mskus.add(msku);

    let site = siteMap.get(link.marketplace);
    if (!site) { site = { stores: new Map(), people: new Set(), mskus: new Set() }; siteMap.set(link.marketplace, site); }
    site.stores.set(link.storeId, link);
    site.people.add(person);
    if (msku) site.mskus.add(msku);
  }

  const salespeople: PersonLink[] = [...personMap.entries()]
    .map(([name, v]) => ({
      name,
      storeCount: v.stores.size,
      mskuCount: v.mskus.size,
      stores: [...v.stores.values()].sort((a, b) => a.marketplace.localeCompare(b.marketplace) || a.name.localeCompare(b.name)),
      sites: [...v.sites].sort(),
    }))
    .sort((a, b) => b.storeCount - a.storeCount || a.name.localeCompare(b.name));

  const stores: StorePersonView[] = storeRows.map((s) => {
    const meta = siteMeta(s.marketplace);
    const v = storeMap.get(s.id);
    return {
      externalId: s.externalId, name: s.name, marketplace: s.marketplace,
      code: meta.code, label: meta.label, country: s.country, status: s.status,
      personCount: v?.people.size ?? 0, mskuCount: v?.mskus.size ?? 0,
      people: [...(v?.people ?? [])].sort(),
    };
  });

  const sites: SiteLink[] = [...siteMap.entries()]
    .map(([marketplace, v]) => {
      const meta = siteMeta(marketplace);
      return {
        marketplace, code: meta.code, label: meta.label,
        storeCount: v.stores.size, personCount: v.people.size, mskuCount: v.mskus.size,
        stores: [...v.stores.values()].sort((a, b) => a.name.localeCompare(b.name)),
        people: [...v.people].sort(),
      };
    })
    .sort((a, b) => b.storeCount - a.storeCount || a.label.localeCompare(b.label));

  return {
    dimension: "salesperson",
    salespeople, stores, sites,
    coverage: {
      stores: storeRows.length,
      people: salespeople.length,
      sites: sites.length,
      snapshotRows: snapshotRowCount,
    },
  };
}
