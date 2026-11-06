import type { Prisma } from "@prisma/client";

// These are the triggers emitted by existing structure creation/retry paths.
// Unknown tasks must never be treated as structure merely because they share a plan.
const structureTriggers = ["schedule", "scheduled-structure", "manual-structure", "manual-retry"];
const structureStages = ["DISCOVER", "campaigns", "ad-groups", "keywords", "targets", "negatives", "product-ads", "reports", "COMPLETED_SP_STRUCTURE"];

export const adsTaskRoutingSelect = {
  trigger: true, stage: true, requestedFrom: true, requestedTo: true,
  _count: { select: { reportRequests: true, reportVersions: true } },
} as const;

type RoutingTask = Prisma.AmazonAdsSyncTaskGetPayload<{ select: typeof adsTaskRoutingSelect }>;
export function isAdsStructureTask(task: RoutingTask): boolean {
  return structureTriggers.includes(task.trigger) && structureStages.includes(task.stage)
    && task.requestedFrom === null && task.requestedTo === null
    && task._count.reportRequests === 0 && task._count.reportVersions === 0;
}

/** Shared by dispatch, recovery and claim. Old structure checkpoints retain their indexes. */
export function adsStructureTaskWhere(): Prisma.AmazonAdsSyncTaskWhereInput {
  return {
    trigger: { in: [...structureTriggers] }, stage: { in: [...structureStages] },
    requestedFrom: null, requestedTo: null,
    reportRequests: { none: {} }, reportVersions: { none: {} },
  };
}
