import { amazonAccountReadAccess } from "./read-account";
import { prisma } from "@/lib/db/prisma";
import { sourceAccessWhere } from "./data-access";
import { resolveMcpDataset, normalizeDatasetQuery, enrichDatasetResult, McpDatasetError } from "./mcp-datasets";
import { randomUUID } from "node:crypto";
import { querySkillTable } from "./skill-data";
import type { SyncScope } from "./policy";
import { assertAmazonMcpScope } from "./mcp-scope";

/** ERP's generic read uses exactly the same registry and reader as data_query. */
export async function readDataset(scope: SyncScope, params: URLSearchParams, actor: string) {
  const input: Record<string, unknown> = Object.fromEntries(params);
  delete input.section;
  delete input.workspaceId;
  assertAmazonMcpScope("data_query", input);
  if (params.getAll("sellerAccountId").length !== 1 || params.getAll("marketplaceId").length !== 1) throw new McpDatasetError("DATASET_SCOPE_REQUIRED", "数据查询必须指定唯一账号和站点。", 403);
  for (const name of ["page", "pageSize"]) if (input[name] !== undefined) input[name] = Number(input[name]);
  const dataset = resolveMcpDataset(input);
  if (dataset.module !== "amazon_sync") throw new McpDatasetError("DATASET_NOT_SUPPORTED", "此入口只读取 SP-API；Ads 沿用独立权限与查询入口。", 409);
  const normalized = normalizeDatasetQuery(dataset, input);
  const access = await amazonAccountReadAccess(scope, actor, params, prisma, dataset.resource);
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { AND: [scope, sourceAccessWhere(access), { resource: dataset.resource }, ...(input.sellerAccountId ? [{ sellerAccountId: input.sellerAccountId }] : []), ...(input.marketplaceId && dataset.resource !== "finance" ? [{ marketplaceId: input.marketplaceId }] : [])] }, include: { publishedRun: { select: { status: true, executionVersion: true, resource: true, sourceId: true, finishedAt: true, stage: true } } }, take: 201 });
  if (sources.length > 200) throw new McpDatasetError("DATASET_CAPACITY", "查询来源超过当前容量。", 409);
  const querySources = dataset.resource === "finance" ? sources.map(source => ({ ...source, marketplaceId: String(input.marketplaceId) })) : sources;
  const result = await querySkillTable({ scope, actor, sources: querySources, tableName: dataset.name, filters: normalized.filters, page: normalized.page, pageSize: normalized.pageSize });
  await amazonAccountReadAccess(scope, actor, params, prisma, dataset.resource);
  return enrichDatasetResult(result, { dataset, filters: normalized.filters, requestId: randomUUID(), toolVersion: "erp-shared-reader.v1", scopePairs: sources.map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId })) });
}
