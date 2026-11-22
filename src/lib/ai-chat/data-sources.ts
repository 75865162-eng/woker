import { prisma } from "@/lib/db/prisma";
import type { ChatScope } from "./types";
import { listMcpCredentials } from "@/lib/amazon-sync/mcp";
import { listSellfoxMcpCredentials } from "@/lib/sellfox/mcp";
import { siteCodeForDisplay } from "@/lib/sellfox/marketplace-site";

export const CHAT_DATA_PROVIDERS = ["amazon", "sellfox"] as const;
export type ChatDataProvider = (typeof CHAT_DATA_PROVIDERS)[number];

export type ChatDataSourceStatus = {
  provider: ChatDataProvider;
  label: string;
  configured: boolean;
  credentialName: string | null;
  toolCount: number;
  scopeSummary: string;
  readOnly: true;
};

export type ChatDataSourceSnapshot = {
  sources: ChatDataSourceStatus[];
  enabledProviders: ChatDataProvider[];
  confirmedAt: string | null;
  /** 至少有一个被启用且凭证可用的数据源，才可以发起对话。 */
  ready: boolean;
};

function activeCredential<T extends { status: string; expiresAt: Date }>(rows: T[]): T | undefined {
  return rows.find(row => row.status === "ACTIVE" && row.expiresAt.getTime() > Date.now());
}

function amazonScopeSummary(scopes: unknown): string {
  if (!Array.isArray(scopes) || !scopes.length) return "未限定账号/站点（按 ERP 授权）";
  let sellers = 0;
  const markets = new Set<string>();
  for (const raw of scopes) {
    const scope = raw as { sellerAccountId?: string; marketplaceIds?: string[] };
    if (scope?.sellerAccountId) sellers += 1;
    for (const id of scope?.marketplaceIds ?? []) markets.add(String(id));
  }
  return `${sellers} 个卖家账号 · ${markets.size} 个站点`;
}

function sellfoxScopeSummary(storeIds: string[], stores: Array<{ id: string; name: string; marketplace: string | null }>): string {
  if (!storeIds.length) return "全部可见店铺（按数据访问授权）";
  const names = storeIds.map(id => {
    const store = stores.find(s => s.id === id);
    if (!store) return id;
    const site = store.marketplace ? siteCodeForDisplay(store.marketplace) : "";
    return site ? `${store.name}（${site}）` : store.name;
  });
  return names.length <= 3 ? names.join("、") : `${names.slice(0, 3).join("、")} 等 ${names.length} 个店铺`;
}

/** 读取当前账号两套 MCP 凭证的真实状态与权限范围（只读，不暴露 token）。 */
export async function inspectChatDataSources(scope: ChatScope): Promise<ChatDataSourceStatus[]> {
  const [amazonCreds, sellfoxCreds, stores] = await Promise.all([
    listMcpCredentials({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, scope.userId).catch(() => []),
    listSellfoxMcpCredentials({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, scope.userId).catch(() => []),
    prisma.sellfoxStore.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
      select: { id: true, name: true, marketplace: true },
      take: 500,
    }).catch(() => []),
  ]);

  const amz = activeCredential(amazonCreds);
  const sf = activeCredential(sellfoxCreds);

  return [
    {
      provider: "amazon",
      label: "Amazon",
      configured: Boolean(amz),
      credentialName: amz?.name ?? null,
      toolCount: amz?.tools?.length ?? 0,
      scopeSummary: amz ? amazonScopeSummary(amz.scopes) : "未配置只读 MCP 凭证",
      readOnly: true,
    },
    {
      provider: "sellfox",
      label: "赛狐 Sellfox",
      configured: Boolean(sf),
      credentialName: sf?.name ?? null,
      toolCount: sf?.tools?.length ?? 0,
      scopeSummary: sf ? sellfoxScopeSummary(sf.storeIds ?? [], stores) : "未配置只读 MCP 凭证",
      readOnly: true,
    },
  ];
}

export async function getChatDataSourceConfig(scope: ChatScope) {
  return prisma.aiChatDataSourceConfig.findUnique({
    where: {
      organizationId_workspaceId_userId: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
      },
    },
  });
}

/** 预检快照：凭证状态 + 已确认启用的数据源 + 是否可开始对话。 */
export async function getChatDataSourceSnapshot(scope: ChatScope): Promise<ChatDataSourceSnapshot> {
  const [sources, config] = await Promise.all([
    inspectChatDataSources(scope),
    getChatDataSourceConfig(scope),
  ]);
  const configured = new Set(sources.filter(s => s.configured).map(s => s.provider));
  const enabledProviders = (config?.enabledProviders ?? []).filter(
    (p): p is ChatDataProvider => CHAT_DATA_PROVIDERS.includes(p as ChatDataProvider) && configured.has(p as ChatDataProvider),
  ) as ChatDataProvider[];
  return {
    sources,
    enabledProviders,
    confirmedAt: config?.confirmedAt?.toISOString() ?? null,
    ready: enabledProviders.length > 0,
  };
}

/**
 * 保存用户确认启用的数据源。只能启用当前确有 ACTIVE 凭证的 provider；
 * 至少启用一个（允许传空数组以显式关闭，关闭后对话会被门禁挡住）。
 */
export async function saveChatDataSourceConfig(scope: ChatScope, requested: unknown): Promise<ChatDataSourceSnapshot> {
  const sources = await inspectChatDataSources(scope);
  const configured = new Set(sources.filter(s => s.configured).map(s => s.provider));
  const incoming = Array.isArray(requested) ? requested : [];
  const enabledProviders = Array.from(new Set(
    incoming.filter((p): p is ChatDataProvider => CHAT_DATA_PROVIDERS.includes(p as ChatDataProvider) && configured.has(p as ChatDataProvider)),
  ));

  await prisma.aiChatDataSourceConfig.upsert({
    where: {
      organizationId_workspaceId_userId: {
        organizationId: scope.organizationId,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
      },
    },
    create: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      enabledProviders,
      confirmedAt: new Date(),
    },
    update: { enabledProviders, confirmedAt: new Date() },
  });

  return {
    sources,
    enabledProviders,
    confirmedAt: new Date().toISOString(),
    ready: enabledProviders.length > 0,
  };
}

/** 门禁：返回当前已确认启用且凭证可用的数据源；未配置抛错由 API 转为 409。 */
export async function requireEnabledChatDataSources(scope: ChatScope): Promise<ChatDataProvider[]> {
  const snapshot = await getChatDataSourceSnapshot(scope);
  if (!snapshot.ready) {
    const err = new Error("AI 对话尚未配置数据源。请先在对话页确认启用 Amazon / 赛狐 的只读 MCP 数据源。") as Error & { code?: string };
    err.code = "MCP_NOT_CONFIGURED";
    throw err;
  }
  return snapshot.enabledProviders;
}
