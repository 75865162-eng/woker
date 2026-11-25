import { prisma } from "@/lib/db/prisma";
import { refreshSellfoxListingProfile } from "@/lib/sellfox/listing-profile-refresh";
import { refreshSellfoxAggregates } from "@/lib/sellfox/agg-refresh";
import { loadSalesFxProjection } from "@/lib/sellfox/sales-fx-projection";

/**
 * Single post-sync projection hook. Every projection is:
 *  - gated by an env switch (OFF by default) so enabling the read path is a deliberate,
 *    reconcilable decision — never an implicit side effect of a sync;
 *  - derived strictly from source tables / existing views (no new business facts);
 *  - best-effort: the sync-service caller wraps this entire call in try/catch, and each
 *    projection here also guards itself, so a projection failure can never fail a sync.
 */
export type PostSyncProjectionInput = {
  organizationId: string;
  workspaceId: string;
  resource: string;
  shopExternalIds: string[];
  reportDate?: string;
  startDate?: string;
  endDate?: string;
  runId: string;
};

function listingProfileWriteEnabled() {
  return process.env.SELLFOX_LISTING_PROFILE_READ_ENABLED === "true";
}

function aggWriteEnabled() {
  return process.env.SELLFOX_AGG_READ_ENABLED === "true";
}

export async function runPostSyncProjections(input: PostSyncProjectionInput) {
  // P1 3.2: refresh the current-listing profile for the synced stores.
  if (input.resource === "listings" && listingProfileWriteEnabled() && input.shopExternalIds.length) {
    try {
      const stores = await prisma.sellfoxStore.findMany({
        where: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          externalId: { in: input.shopExternalIds },
        },
        select: { id: true },
      });
      if (stores.length) {
        await refreshSellfoxListingProfile({
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          storeIds: stores.map((s) => s.id),
        });
      }
    } catch (error) {
      console.error(JSON.stringify({ scope: "sellfox.projection.listing-profile", runId: input.runId, message: error instanceof Error ? error.message : "unknown" }));
    }
  }

  // P2 L4: incrementally upsert the pre-aggregated tables for the synced domain.
  if (aggWriteEnabled()) {
    try {
      // 报告1 P1：仅在显式开启 FX 投影且存在已复核汇率时，物化 fxRate/amountBase；
      // 否则传 undefined → 两列写 NULL（绝不臆造）。加载失败也 fail-safe 为 undefined。
      const fx = input.resource === "sales"
        ? await loadSalesFxProjection({ organizationId: input.organizationId, workspaceId: input.workspaceId }, prisma)
        : undefined;
      await refreshSellfoxAggregates({
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        resource: input.resource,
        shopExternalIds: input.shopExternalIds,
        reportDate: input.reportDate,
        startDate: input.startDate,
        endDate: input.endDate,
        runId: input.runId,
        fx,
      });
    } catch (error) {
      console.error(JSON.stringify({ scope: "sellfox.projection.aggregates", resource: input.resource, runId: input.runId, message: error instanceof Error ? error.message : "unknown" }));
    }
  }
}
