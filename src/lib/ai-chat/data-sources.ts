import { prisma } from "@/lib/db/prisma";
import type { ChatScope } from "./types";
import { listMcpCredentials } from "@/lib/amazon-sync/mcp";
import { listSellfoxMcpCredentials } from "@/lib/sellfox/mcp";
import { siteCodeForDisplay } from "@/lib/sellfox/marketplace-site";
import { getSellerSpriteMcpSettings } from "@/lib/server/integration-settings";
import { toolConfigStore } from "@/lib/lili/tool-config-server";
import { xiyouResearchReadTools } from "@/lib/lili/runtime-tools";
import { sellerSpriteIntegrationProvider } from "@/lib/integrations/sellersprite";

export const CHAT_DATA_PROVIDERS = ["amazon", "sellfox", "sellersprite", "xiyou"] as const;
export type ChatDataProvider = (typeof CHAT_DATA_PROVIDERS)[number];

export type ChatDataSourceStatus = {
  provider: ChatDataProvider;
  label: string;
  configured: boolean;
  credentialName: string | null;
  toolCount: number;
  scopeSummary: string;
  readOnly: true;
  /** 第三方付费数据源：工具调用可能产生供应商费用，需在界面显著标注。 */
  paidExternal?: boolean;
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

/**
 * 读取当前账号已配置数据源的真实状态与权限范围（只读，不暴露 token）。
 * 四套凭证都只读取本地持久化的启用状态/元数据；绝不在此阶段连接外部付费 API、
 * 不做工具发现，避免预检产生费用或网络副作用。
 */
export async function inspectChatDataSources(scope: ChatScope): Promise<ChatDataSourceStatus[]> {
  const settingsScope = { workspaceId: scope.workspaceId, accountId: "", marketplace: "" };
  const [amazonCreds, sellfoxCreds, stores, sellerSprite, xiyou] = await Promise.all([
    listMcpCredentials({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, scope.userId).catch(() => []),
    listSellfoxMcpCredentials({ organizationId: scope.organizationId, workspaceId: scope.workspaceId }, scope.userId).catch(() => []),
    prisma.sellfoxStore.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId },
      select: { id: true, name: true, marketplace: true },
      take: 500,
    }).catch(() => []),
    getSellerSpriteMcpSettings({ organizationId: scope.organizationId, id: scope.userId }, settingsScope).catch(() => null),
    toolConfigStore.read(scope).catch(() => null),
  ]);

  const amz = activeCredential(amazonCreds);
  const sf = activeCredential(sellfoxCreds);
  // 外部数据源：configured 仅取决于本地 enabled + 凭证存在；不连接远端。
  const sfConfigured = Boolean(sellerSprite?.enabled && sellerSprite?.apiKey?.trim() && sellerSprite?.serverUrl?.startsWith("http"));
  const xyConfigured = Boolean(xiyou?.enabled && xiyou?.mcpToken?.trim());

  const sources: ChatDataSourceStatus[] = [
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
    {
      provider: "sellersprite",
      label: "卖家精灵 SellerSprite",
      configured: sfConfigured,
      credentialName: sellerSpriteIntegrationProvider,
      // 只读工具集在运行时按已审核策略动态发现；这里仅报告已审核的只读白名单规模，不触发付费发现。
      toolCount: sfConfigured ? sellerSpriteReadOnlyEstimate() : 0,
      scopeSummary: sfConfigured
        ? `外部付费数据源 · 只读工具在调用时按授权发现 · ${sellerSprite?.marketplace ?? "US"} 站点`
        : "请先在「账号管理 → MCP 与设备凭证」启用卖家精灵",
      readOnly: true,
      paidExternal: true,
    },
    {
      provider: "xiyou",
      label: "西柚 Xiyou",
      configured: xyConfigured,
      credentialName: "xiyou_mcp",
      toolCount: xyConfigured ? xiyouResearchReadTools.size : 0,
      scopeSummary: xyConfigured
        ? "外部付费数据源 · 已审核只读工具 · 调用时按授权发现"
        : "请先在 Lili 工具配置中启用西柚 MCP",
      readOnly: true,
      paidExternal: true,
    },
  ];
  return sources;
}

/** 卖家精灵已审核研究工具的静态规模估计（仅用于预检展示，不代表远端实际注册表）。 */
function sellerSpriteReadOnlyEstimate(): number {
  // 研究工具由 sellerSpritePolicy/canonicalResearchTool 审核，数量与 Lili 侧一致；这里给出保守展示值。
  return 9;
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
    const err = new Error("AI 对话尚未配置数据源。请先在对话页确认启用 Amazon / 赛狐 / 卖家精灵 / 西柚 的只读数据源。") as Error & { code?: string };
    err.code = "MCP_NOT_CONFIGURED";
    throw err;
  }
  return snapshot.enabledProviders;
}
