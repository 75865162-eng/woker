import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sourceAccessWhere } from "./data-access";
import { brandReports, type BrandKind } from "./brand-reports";
import { readBrandCollection } from "./brand-collection-query";
import { businessDate } from "./date-range";
import { SyncInputError, type SyncScope } from "./policy";
import type { Prisma } from "@prisma/client";
import { discoverProductObjects } from "./product-discovery";
import { readBrandProducts } from "./brand-products-query";
import type { BrandWindow } from "./brand-collection";

async function resolveBrandSource(scope: SyncScope, params: URLSearchParams, actor: string) {
  const access = await amazonDataAccess(scope, actor);
  for (const name of ["sourceId", "sellerAccountId", "marketplaceId", "runId", "asin", "searchTerm"]) if ((params.get(name)?.length ?? 0) > 5000) throw new SyncInputError("筛选长度超限。");
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, ...sourceAccessWhere(access), resource: "brand_analytics", ...(params.get("sellerAccountId") ? { sellerAccountId: params.get("sellerAccountId")! } : {}), ...(params.get("marketplaceId") ? { marketplaceId: params.get("marketplaceId")! } : {}) },
    select: { id: true, revision: true, enabled: true, freshnessMinutes: true, authorizationId: true, authorization: { select: { revision: true } }, sellerAccountId: true, marketplaceId: true, domainPolicy: true, seller: { select: { displayName: true } } }, orderBy: { id: "asc" }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("品牌来源超过本次容量。", 409);
  const source = params.get("sourceId") ? sources.find(s => s.id === params.get("sourceId")) : sources[0];
  if (params.get("sourceId") && !source) throw new SyncInputError("品牌来源不可访问。", 403);
  return { source, sources, access };
}
export async function readBrandAnalytics(scope: SyncScope, params: URLSearchParams, actor: string) {
  return readBrandReport(scope, params, await resolveBrandSource(scope, params, actor));
}
async function readBrandReport(scope: SyncScope, params: URLSearchParams, context: Awaited<ReturnType<typeof resolveBrandSource>>, enrich = true) {
  const { source, sources, access } = context;
  const kind = params.get("reportKind") ?? "search_terms";
  if (!Object.hasOwn(brandReports, kind)) throw new SyncInputError("品牌报告类型无效。");
  const definition = brandReports[kind as BrandKind], period = params.get("reportPeriod");
  if (period && !(definition.periods as readonly string[]).includes(period)) throw new SyncInputError("品牌报告周期无效。");
  const from = params.get("from") ? businessDate(params.get("from")) : undefined, to = params.get("to") ? businessDate(params.get("to")) : undefined;
  if (from && to && from > to) throw new SyncInputError("日期范围无效。");
  const base: Prisma.AmazonSyncRunWhereInput = { ...scope, sourceId: source?.id ?? "__none__", resource: "brand_analytics", executionVersion: 2, status: "SUCCEEDED", stage: { not: "PURGED" }, finishedAt: { not: null }, AND: [
    { frozenScope: { path: ["domainPolicy", "reportKind"], equals: kind } },
    ...(period ? [{ frozenScope: { path: ["domainPolicy", "reportPeriod"], equals: period } }] : []),
    ...(from ? [{ frozenScope: { path: ["domainPolicy", "from"], gte: from } }] : []),
    ...(to ? [{ frozenScope: { path: ["domainPolicy", "to"], lte: to } }] : []),
  ] };
  const select = { id: true, finishedAt: true, summary: true, frozenScope: true } as const;
  const versions = await prisma.amazonSyncRun.findMany({ where: base, select, orderBy: [{ finishedAt: "desc" }, { id: "desc" }], take: 101 });
  const explicit = params.get("runId");
  const run = explicit ? await prisma.amazonSyncRun.findFirst({ where: { ...base, id: explicit }, select }) : versions[0];
  if (explicit && !run) throw new SyncInputError("该品牌报告版本不可访问或与筛选不符。", 403);
  let runIds: string[] = run ? [run.id] : [];
  if (run && !explicit) {
    const frozen = run.frozenScope as { sourceRevision: number; authorizationId: string; authorizationRevision: number; domainPolicy: { from: string; to: string; reportPeriod: string } }, p = frozen.domainPolicy;
    // A collection uses disjoint, frozen ASIN batches. Select the newest success
    // for each batch in this same source revision and reporting window.
    const siblings = await prisma.amazonSyncRun.findMany({ where: { ...base, AND: [...(base.AND as Prisma.AmazonSyncRunWhereInput[]), ...[
      ["sourceRevision", frozen.sourceRevision], ["authorizationId", frozen.authorizationId], ["authorizationRevision", frozen.authorizationRevision], ["domainPolicy.from", p.from], ["domainPolicy.to", p.to], ["domainPolicy.reportPeriod", p.reportPeriod],
    ].map(([path, value]) => ({ frozenScope: { path: String(path).split("."), equals: value } }))] }, select: { id: true, frozenScope: true }, orderBy: [{ finishedAt: "desc" }, { id: "desc" }], take: 1001 });
    if (siblings.length > 1000) throw new SyncInputError("该品牌窗口版本数量超出容量，请指定版本。", 409);
    const seen = new Set<string>(); runIds = [];
    for (const sibling of siblings) { const asins = (sibling.frozenScope as { domainPolicy: { asins: string[] } }).domainPolicy.asins; const key = JSON.stringify([...asins].sort()); if (!seen.has(key)) { seen.add(key); runIds.push(sibling.id); } }
  }
  const page = Math.min(100000, Math.max(1, Math.floor(Number(params.get("page")) || 1))), pageSize = 50;
  const where: Prisma.AmazonDomainObservationWhereInput = { ...scope, sourceId: source?.id ?? "__none__", sourceRunId: { in: runIds }, kind: `BRAND_${kind.toUpperCase()}`, ...(params.get("asin") ? { asin: params.get("asin")! } : {}), ...(params.get("searchTerm") ? { searchTerm: { contains: params.get("searchTerm")!, mode: "insensitive" } } : {}) };
  const [rows, total, latestTask, collection, plans] = await Promise.all([
    prisma.amazonDomainObservation.findMany({ where, select: { id: true, sourceRunId: true, asin: true, searchTerm: true, facts: true, capturedAt: true }, orderBy: [{ asin: "asc" }, { id: "asc" }], take: pageSize, skip: (page - 1) * pageSize }),
    prisma.amazonDomainObservation.count({ where }),
    source && enrich ? prisma.amazonSyncRun.findFirst({ where: { ...scope, sourceId: source.id, executionVersion: 2 }, select: { id: true, status: true, stage: true, error: true }, orderBy: [{ startedAt: "desc" }, { id: "desc" }] }) : null,
    source && params.get("coverage") === "1" ? readBrandCollection(prisma, scope, source) : null,
    source && enrich ? prisma.amazonSyncSchedule.findMany({ where: { ...scope, resource: "brand_analytics", executionVersion: 2, targets: { some: { sourceId: source.id } } }, select: { id: true, revision: true, name: true, enabled: true, mode: true, intervalMinutes: true, maxAttempts: true, priority: true, retentionDays: true }, take: 10 }) : [],
  ]);
  const linked = source && enrich ? await readBrandProducts(scope, source, rows.flatMap(row => {
    const partner = (row.facts as { purchasedWithAsin?: unknown }).purchasedWithAsin;
    return [...(row.asin ? [row.asin] : []), ...(kind === "market_basket" && typeof partner === "string" ? [partner] : [])];
  }), access) : { products: {}, warnings: [] };
  const publicSource = (s: typeof sources[number]) => ({ id: s.id, revision: s.revision, sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, seller: s.seller });
  return { sources: sources.map(publicSource), source: source ? publicSource(source) : null,
    configuration: source && access.allSellers ? { ...publicSource(source), authorizationId: source.authorizationId, enabled: source.enabled, freshnessMinutes: source.freshnessMinutes, domainPolicy: source.domainPolicy } : null,
    products: linked.products, productWarnings: linked.warnings, plans, collection: collection ? { definition: collection.policy.collection, total: collection.total, completed: collection.completed, complete: collection.complete, items: collection.items } : null,
    rows, versions: versions.slice(0, 100).map(v => ({ id: v.id, finishedAt: v.finishedAt, coverage: (v.summary as { coverage?: BrandWindow } | null)?.coverage })), versionsTruncated: versions.length > 100,
    run: run ? { id: run.id, coverage: (run.summary as { coverage?: BrandWindow } | null)?.coverage } : null, batchCount: runIds.length, latestTask, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}

/** Single-ASIN view: five bounded report reads, one product metadata join. */
export async function readBrandAsinAnalysis(scope: SyncScope, params: URLSearchParams, actor: string) {
  const asin = params.get("asin") ?? "", period = params.get("reportPeriod") || "WEEK";
  if (!/^[A-Z0-9]{10}$/.test(asin) || !["DAY", "WEEK", "MONTH", "QUARTER"].includes(period)) throw new SyncInputError("请选择有效 ASIN 与报告粒度。", 422);
  const context = await resolveBrandSource(scope, params, actor);
  const reports = await Promise.all((Object.keys(brandReports) as BrandKind[]).map(async reportKind => {
    if (!(brandReports[reportKind].periods as readonly string[]).includes(period)) return { reportKind, unavailable: true, result: null };
    const p = new URLSearchParams(params); p.set("reportKind", reportKind); p.set("reportPeriod", period); p.set("page", "1"); p.set("coverage", "0"); p.delete("runId");
    const result = await readBrandReport(scope, p, context, false);
    return { reportKind, unavailable: false, result: { rows: result.rows, run: result.run, batchCount: result.batchCount, pagination: result.pagination } };
  }));
  const partners = reports.filter(r => r.reportKind === "market_basket").flatMap(r => r.result?.rows.map(row => (row.facts as { purchasedWithAsin?: unknown }).purchasedWithAsin).filter((v): v is string => typeof v === "string") ?? []);
  const linked = context.source ? await readBrandProducts(scope, context.source, [asin, ...partners], context.access) : { products: {}, warnings: [] };
  return { asin, reportPeriod: period, source: context.source ? { id: context.source.id, sellerAccountId: context.source.sellerAccountId, marketplaceId: context.source.marketplaceId } : null, products: linked.products, productWarnings: linked.warnings, reports };
}

export async function readBrandAsins(scope: SyncScope, sourceId: string, actor: string) {
  if (!sourceId || sourceId.length > 200) throw new SyncInputError("请选择品牌来源。");
  const access = await amazonDataAccess(scope, actor);
  const source = await prisma.amazonSyncDataSource.findFirst({ where: { ...scope, ...sourceAccessWhere(access), id: sourceId, resource: "brand_analytics" }, include: { authorization: { select: { revision: true, amazonSellerId: true } } } });
  if (!source) throw new SyncInputError("品牌来源不可访问。", 403);
  const catalog = await prisma.amazonSyncDataSource.findFirst({ where: { ...scope, ...sourceAccessWhere(access), authorizationId: source.authorizationId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: "catalog", enabled: true }, select: { id: true } });
  if (!catalog) throw new SyncInputError("该品牌来源没有同授权、同站点的完整商品快照。", 409);
  const manifest = await discoverProductObjects(prisma, scope, source, { resource: "catalog_items", applicationId: "brand-preview", asins: [], discovery: { mode: "catalog_snapshot", sourceId: catalog.id, maxObjects: 1000, batchSize: 100 }, requestsPerSecond: .01, maxRequests: 1000, maxRows: 1000 });
  return { manifest, note: "此清单来自当前已发布商品快照，仅为资格候选；不证明每个 ASIN 有品牌报告资格。批准后对象列表冻结，新商品需重新审阅。" };
}
