/**
 * Amazon Ads 同步成功后的一致性失效入口。
 *
 * 背景：result-cache.ts 早已提供 invalidateAmazonDomain / invalidateAmazonTenant，
 * 但全仓没有调用点 —— Ads 缓存只能靠 TTL 自然过期，最长 300s 陈旧窗口。
 * 本模块把这些失效能力接到「数据已成功发布」之后，遵循两条原则：
 *   1. 只在事务提交、任务确认为 SUCCEEDED / 报表 PUBLISHED 之后失效；
 *   2. 失效失败只记日志（fail-open），绝不把已完成的同步改判为失败。
 *
 * 依赖注入 `invalidate` 便于单测断言「成功点确实触发了失效」而无需 Redis。
 */
import { invalidateAmazonTenant } from "./result-cache";

export type AdsCacheInvalidator = (organizationId: string, workspaceId: string) => Promise<void>;

/** 默认失效器：清掉该租户下所有 Amazon 读缓存（ads_metadata + report_acquisition）。 */
export const defaultAdsCacheInvalidator: AdsCacheInvalidator = async (organizationId, workspaceId) => {
  await invalidateAmazonTenant(organizationId, workspaceId);
};

/**
 * 在广告数据成功发布后调用。scope 必须含 org + ws。
 * 任何异常都被吞掉并记录（fail-open），返回 boolean 表示失效是否成功（供观测/测试）。
 */
export async function invalidateAmazonAdsAfterSync(
  scope: { organizationId: string; workspaceId: string },
  _reason: string,
  invalidate: AdsCacheInvalidator = defaultAdsCacheInvalidator,
): Promise<boolean> {
  try {
    await invalidate(scope.organizationId, scope.workspaceId);
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      scope: "amazon.ads.cache-invalidate",
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      message: error instanceof Error ? error.message.slice(0, 120) : "unknown",
    }));
    return false;
  }
}
