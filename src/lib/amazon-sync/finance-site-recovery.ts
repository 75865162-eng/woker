import type { AmazonSyncRun, Prisma } from "@prisma/client";
import { unseal } from "./approval-policy";
import { attributeFinanceTransaction, financeWindowFromFrozen, parseFinancePage, parseFinancePolicy } from "./finance";
import { responseArchiveHashMatches } from "./response-evidence";
import { SyncInputError } from "./policy";

/** Read-only manifest; the existing change request binds this raw page and task. */
export async function inspectFinanceSiteRecovery(tx: Prisma.TransactionClient, run: AmazonSyncRun) {
  if (run.resource !== "finance" || run.status !== "FAILED" || run.error !== "财务响应含批准范围之外的站点，整页未提交。" || run.leaseOwner || run.leaseExpiresAt) throw new SyncInputError("财务任务不是可恢复的站点越界失败。", 409);
  const scope = { organizationId: run.organizationId, workspaceId: run.workspaceId };
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: run.sourceId! }, include: { authorization: true, resourceCursor: true } });
  const window = financeWindowFromFrozen((run.frozenScope as { financeWindow?: unknown }).financeWindow);
  const cursor = source.resourceCursor;
  if (!cursor || cursor.activeRunId !== run.id || cursor.watermarkFrom.toISOString() !== window.from || cursor.watermarkTo.toISOString() !== window.to) throw new SyncInputError("财务游标已变化，不能恢复该原件。", 409);
  const raw = await tx.amazonSyncRawPage.findFirst({ where: { ...scope, taskId: run.id, resource: "finance", page: run.pagesCompleted + 1 } });
  if (!raw) throw new SyncInputError("缺少已归档的失败页，不能启用隔离恢复。", 409);
  const body = unseal(raw.rawCiphertext, scope, `${run.id}:${raw.page}`, "amazon-finance-raw.v1").rawBody;
  if (typeof body !== "string" || !responseArchiveHashMatches(body, raw.bodySha256)) throw new SyncInputError("财务失败页原件校验失败。", 409);
  const page = parseFinancePage(body, window), policy = parseFinancePolicy(source.financePolicy);
  let quarantined = 0;
  for (const row of page.transactions) if (attributeFinanceTransaction(row, source.authorization.amazonSellerId, policy, true).reason === "OUTSIDE_APPROVED_MARKETPLACE") quarantined++;
  if (!quarantined) throw new SyncInputError("失败页没有可确认的越界站点行。", 409);
  return { version: "finance-site-quarantine.v1", taskId: run.id, sourceId: source.id, sourceRevision: source.revision, rawPage: raw.page, rawSha256: raw.bodySha256, window, rows: page.transactions.length, outOfScopeRows: quarantined, approvedMarketplaceIds: policy.marketplaces.map(site => site.marketplaceId) };
}
