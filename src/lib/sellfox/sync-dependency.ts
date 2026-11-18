import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { finishSellfoxRun, type SellfoxRunLease } from "./run-lease";

/**
 * 赛狐同步依赖状态机的共享原语。
 *
 * status 是普通字符串字段（非数据库 enum），新增 waiting_dependency 不需要迁移。
 * 依赖仅有一个硬前置：stores 必须先成功落库，其余数据域才有店铺外键可用。
 * 本模块只负责「状态标记 + 前置就绪判定」，唤醒与重排的编排在 sync-orchestrator。
 */
export const WAITING_DEPENDENCY = "waiting_dependency";
export const NO_STORE_ERROR_TEXT = "当前工作区没有可同步店铺，请先同步店铺。";

export type SellfoxScope = { organizationId: string; workspaceId: string };

type StoreCounter = Pick<Prisma.TransactionClient, "sellfoxStore">;

export function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 该工作区是否已有店铺落库——stores 同步成功的直接证据。 */
export async function sellfoxStoresReady(scope: SellfoxScope, db: StoreCounter = prisma): Promise<boolean> {
  const count = await db.sellfoxStore.count({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId } });
  return count > 0;
}

/**
 * 当前 run 缺少前置店铺数据时调用：正常释放租约并把状态置为 waiting_dependency。
 * 调用方必须直接 return，不得再抛错，否则 worker 会按失败/重试路径处理。
 */
export async function markRunWaitingDependency(lease: SellfoxRunLease, runId: string, reason: string) {
  const current = await prisma.sellfoxSyncRun.findUnique({ where: { id: runId }, select: { summary: true } });
  const summary = {
    ...asJsonObject(current?.summary),
    dependencyReason: reason,
    dependencyResource: "stores",
  };
  await finishSellfoxRun(lease, { status: WAITING_DEPENDENCY, error: null, summary: summary as Prisma.InputJsonValue });
}
